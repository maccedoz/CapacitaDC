"""
api/nodes.py — Training node endpoints (/api/nodes/*)
"""

import uuid
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.auth import get_current_user, get_current_staff
from app.services import node_service, access
from app.services.assessment_service import validate_settings
from app.services.activity_service import recompute_users_grades
from app.services.game_service import revision_for_node
from app.services.activity_service import activity_deadline, activity_weight, is_effectively_open, submission_to_out

router = APIRouter()


@router.get("/", response_model=List[schemas.TrainingNodeGraphOut])
@router.get("", response_model=List[schemas.TrainingNodeGraphOut])
def get_training_nodes(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return node_service.list_nodes_for_user(db, current_user)


@router.get("/{node_id}/content", response_model=schemas.NodeContentOut)
def get_node_content(
    node_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    node = db.get(models.TrainingNode, node_id)
    if node is None:
        raise HTTPException(404, "Etapa não encontrada")
    access.ensure_node_access(db, node, current_user, require_unlocked=True)

    activity_out = None
    # Activity nodes always resolve their material through the activity. Older
    # material-only nodes remain readable without creating an artificial activity.
    if node.type == "activity" or node.activity_id:
        activity = db.get(models.Activity, node.activity_id or node.reference_id) if (node.activity_id or node.reference_id) else None
        if activity is None:
            raise HTTPException(404, "Esta etapa está sem atividade disponível. Peça ao responsável pela trilha para vincular uma atividade.")
        access.ensure_activity_access(current_user, activity)
        material_id = activity.material_id
        submission = next((s for s in activity.submissions if s.user_id == current_user.id), None)
        # Pela etapa, vale o prazo dela: é ele que a entrega feita por aqui respeita.
        deadline, from_trail = (node.deadline, True) if node.type == "activity" else activity_deadline(db, activity)
        # Validado de novo para o prazo sair em UTC explícito, como nas demais respostas.
        activity_out = schemas.ActivityOut.model_validate({
            **schemas.ActivityOut.model_validate(activity).model_dump(),
            "deadline": deadline, "deadline_from_trail": from_trail,
        })
        activity_out.weight = activity_weight(activity)
        activity_out.effective_open = is_effectively_open(activity, deadline)
        activity_out.submission_count = len(activity.submissions)
        activity_out.my_submission = submission_to_out(submission, user=current_user, activity=activity) if submission else None
    else:
        material_id = node.reference_id
        if not material_id and node.type != "game":
            raise HTTPException(404, "Esta etapa está sem conteúdo vinculado. Peça ao responsável pela trilha para vincular uma atividade.")

    material = db.get(models.Material, material_id) if material_id else None
    if material_id and material is None:
        raise HTTPException(404, "O material vinculado não foi encontrado. Peça ao responsável para atualizar o material da atividade.")
    if material:
        access.ensure_material_access(current_user, material)
    progress = db.query(models.UserNodeProgress).filter_by(user_id=current_user.id, node_id=node.id).first()
    return schemas.NodeContentOut(
        node=node_service.node_to_out(node, completed=bool(progress and progress.completed),
                                      user_score=progress.score if progress else 0, grade=progress.grade if progress else None, include_answers=False),
        activity=activity_out,
        material=material,
    )


@router.patch("/{node_id}/activity", response_model=schemas.TrainingNodeGraphOut)
def update_node_activity(
    node_id: str,
    payload: schemas.NodeActivityUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_staff),
):
    node = db.get(models.TrainingNode, node_id)
    if node is None:
        raise HTTPException(404, "Etapa não encontrada")
    access.ensure_node_eixo_access(current_user, node.eixo)
    access.ensure_contained_in_axis(db, current_user, node)
    if node.type == "game":
        raise HTTPException(400, "Etapas de jogo não podem ser convertidas em atividades.")
    activity = db.get(models.Activity, payload.activity_id)
    if activity is None:
        raise HTTPException(404, "Atividade não encontrada")
    access.ensure_activity_access(current_user, activity, manage=True)
    if activity.eixo not in {node.eixo, "all"}:
        raise HTTPException(400, "A atividade deve pertencer ao eixo da etapa")
    node.type = "activity"
    node.activity_id = activity.id
    node.reference_id = None
    db.commit()
    db.refresh(node)
    return node_service.node_to_out(node)


@router.post("/", response_model=schemas.TrainingNodeGraphOut)
@router.post("", response_model=schemas.TrainingNodeGraphOut)
def create_training_node(
    node_in: schemas.TrainingNodeCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_staff),
):
    access.ensure_node_eixo_access(current_user, node_in.eixo)
    node_name = (node_in.name or "").strip()
    activity_id = node_in.activity_id or (
        node_in.reference_id if node_in.type == "activity" else None
    )
    reference_id = node_in.reference_id if node_in.type in {"material", "game"} else None

    revision = None
    if node_in.game_revision_id:
        revision = revision_for_node(db, node_in.game_revision_id, node_in.eixo, current_user)

    act = None
    if activity_id:
        act = db.query(models.Activity).filter(models.Activity.id == activity_id).first()
        if not act:
            raise HTTPException(status_code=404, detail="Atividade não encontrada")
        access.ensure_activity_access(current_user, act, manage=True)
        if act.eixo not in {node_in.eixo, "all"}:
            raise HTTPException(status_code=400, detail="A atividade deve pertencer ao eixo da etapa")
    if reference_id:
        material = db.query(models.Material).filter(models.Material.id == reference_id).first()
        if not material:
            raise HTTPException(status_code=404, detail="Material não encontrado")
        access.ensure_material_access(current_user, material, manage=True)
        if material.eixo not in {node_in.eixo, "all"}:
            raise HTTPException(status_code=400, detail="O material deve pertencer ao eixo da etapa")
    if node_in.prerequisite_node_id:
        prerequisite = db.query(models.TrainingNode).filter(models.TrainingNode.id == node_in.prerequisite_node_id).first()
        if not prerequisite:
            raise HTTPException(status_code=404, detail="Pré-requisito não encontrado")
        access.ensure_node_access(db, prerequisite, current_user)
        if prerequisite.eixo != node_in.eixo:
            raise HTTPException(status_code=400, detail="O pré-requisito deve pertencer ao eixo da etapa")

    if not node_name:
        if act:
            node_name = act.title
        elif revision:
            node_name = revision.title
        elif node_in.type == "material" and reference_id:
            mat = db.query(models.Material).filter(
                models.Material.id == reference_id
            ).first()
            if mat:
                node_name = mat.name
        if not node_name:
            node_name = "Nó de Aprendizado"

    existing_count = db.query(models.TrainingNode).filter(
        models.TrainingNode.eixo == node_in.eixo
    ).count()

    new_node = models.TrainingNode(
        id=str(uuid.uuid4()),
        name=node_name,
        type=node_in.type,
        eixo=node_in.eixo,
        activity_id=activity_id,
        reference_id=reference_id,
        game_revision_id=node_in.game_revision_id,
        allow_retry=node_in.allow_retry, is_required=node_in.is_required, weight=node_in.weight,
        deadline=node_in.deadline,
        prerequisite_node_id=node_in.prerequisite_node_id,
        is_released=node_in.is_released,
        order_index=existing_count,
    )
    db.add(new_node)
    db.flush()

    for q_in in node_in.questions:
        question = models.Question(
            id=str(uuid.uuid4()),
            node_id=new_node.id,
            text=q_in.text,
            explanation=q_in.explanation or "",
        )
        db.add(question)
        db.flush()
        for o_in in q_in.options:
            db.add(models.Option(
                id=str(uuid.uuid4()),
                question_id=question.id,
                text=o_in.text,
                is_correct=o_in.is_correct,
                score=o_in.score,
                feedback=o_in.feedback or "",
            ))

    db.commit()
    db.refresh(new_node)

    return node_service.node_to_out(new_node)


@router.patch("/{node_id}", response_model=schemas.TrainingNodeGraphOut)
def update_training_node(
    node_id: str,
    payload: schemas.TrainingNodeUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_staff),
):
    node = db.get(models.TrainingNode, node_id)
    if node is None:
        raise HTTPException(404, "Etapa não encontrada")
    access.ensure_node_eixo_access(current_user, node.eixo)
    access.ensure_contained_in_axis(db, current_user, node)
    changes = payload.model_dump(exclude_unset=True)
    settings = {key: changes[key] for key in ("allow_retry", "is_required", "weight") if key in changes}
    if settings and node.type != "game":
        raise HTTPException(400, "Edite a repetição e a avaliação pela atividade associada")
    validate_settings(node, changes)
    assessment_changed = any(key in changes and changes[key] != getattr(node, key) for key in ("is_required", "weight"))
    affected = [row.user_id for row in node.progress if row.grade is not None] if assessment_changed else []
    if current_user.type == "gerente" and any(not access.can_manage_user(current_user, db.get(models.User, user_id)) for user_id in affected):
        raise HTTPException(403, "Este jogo tem notas de participantes de outro eixo; peça ao administrador para alterar sua avaliação.")
    if "name" in changes and not changes["name"]:
        raise HTTPException(400, "Informe o nome da etapa")
    if "activity_id" in changes:
        if node.type != "activity":
            raise HTTPException(400, "Selecione uma atividade apenas em etapas de atividade")
        activity = db.get(models.Activity, changes["activity_id"]) if changes["activity_id"] else None
        if activity is None:
            raise HTTPException(404, "Atividade não encontrada")
        access.ensure_activity_access(current_user, activity, manage=True)
        if activity.eixo not in {node.eixo, "all"}:
            raise HTTPException(400, "A atividade deve pertencer ao eixo da etapa")
    if "reference_id" in changes:
        if node.type == "activity":
            raise HTTPException(400, "Edite o material pela atividade associada")
        material_id = changes["reference_id"]
        if node.type == "material" and not material_id:
            raise HTTPException(400, "Selecione o material da etapa")
        if material_id:
            material = db.get(models.Material, material_id)
            if material is None:
                raise HTTPException(404, "Material não encontrado")
            access.ensure_material_access(current_user, material, manage=True)
            if material.eixo not in {node.eixo, "all"}:
                raise HTTPException(400, "O material deve pertencer ao eixo da etapa")
    if "game_revision_id" in changes:
        if node.type != "game":
            raise HTTPException(400, "Selecione jogos apenas em etapas de jogo")
        revision_id = changes["game_revision_id"]
        if revision_id:
            revision_for_node(db, revision_id, node.eixo, current_user)
        elif node.game_revision_id:
            raise HTTPException(400, "Selecione um jogo publicado")
        # A tentativa pertence à versão com a qual foi aberta.
        if revision_id != node.game_revision_id and db.query(models.GameAttempt).filter_by(node_id=node.id).first():
            raise HTTPException(400, "Este jogo já possui tentativas. Crie outra etapa para usar uma versão diferente.")
        if revision_id and node.questions:
            raise HTTPException(400, "Crie outra etapa para substituir um questionário antigo por um jogo da biblioteca")
    if "prerequisite_node_id" in changes:
        prerequisite_id = changes["prerequisite_node_id"]
        if prerequisite_id:
            prerequisite = db.get(models.TrainingNode, prerequisite_id)
            if prerequisite is None:
                raise HTTPException(404, "Pré-requisito não encontrado")
            access.ensure_node_access(db, prerequisite, current_user)
            if prerequisite.eixo != node.eixo:
                raise HTTPException(400, "O pré-requisito deve pertencer ao eixo da etapa")
    for field, value in changes.items():
        setattr(node, field, value)
    # Tornar uma etapa opcional também refaz a corrente implícita das seguintes.
    if {"prerequisite_node_id", "is_required"} & changes.keys():
        axis_nodes = db.query(models.TrainingNode).filter_by(eixo=node.eixo).order_by(
            models.TrainingNode.order_index, models.TrainingNode.id).all()
        if access.has_cycle(access.chain_of(axis_nodes)):
            raise HTTPException(400, "O pré-requisito criaria um ciclo na trilha")
    recompute_users_grades(db, affected)
    db.commit()
    db.refresh(node)
    return node_service.node_to_out(node)


@router.delete("/{node_id}")
def delete_training_node(
    node_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_staff),
):
    node = db.query(models.TrainingNode).filter(models.TrainingNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="Nó não encontrado")
    access.ensure_node_eixo_access(current_user, node.eixo)
    access.ensure_contained_in_axis(db, current_user, node)
    affected = [row.user_id for row in node.progress if row.grade is not None]
    if current_user.type == "gerente" and any(not access.can_manage_user(current_user, db.get(models.User, user_id)) for user_id in affected):
        raise HTTPException(403, "Este jogo tem notas de participantes de outro eixo; peça ao administrador para excluí-lo.")
    db.delete(node)
    recompute_users_grades(db, affected)
    db.commit()
    return {"detail": "Nó excluído com sucesso"}


@router.patch("/{node_id}/release", response_model=schemas.TrainingNodeGraphOut)
def release_node(
    node_id: str,
    release_data: schemas.NodeReleaseUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_staff),
):
    node = db.query(models.TrainingNode).filter(models.TrainingNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="Nó não encontrado")

    access.ensure_node_eixo_access(current_user, node.eixo)
    access.ensure_contained_in_axis(db, current_user, node)
    node.is_released = release_data.is_released
    node.released_at = release_data.released_at
    node.released_by = current_user.id if release_data.is_released else None

    db.commit()
    db.refresh(node)

    return node_service.node_to_out(node)


@router.post("/{node_id}/complete")
def complete_material_node(
    node_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.type not in {"membro", "trainee"}:
        raise HTTPException(status_code=403, detail="Somente membros e trainees registram progresso na trilha.")
    node = db.query(models.TrainingNode).filter(models.TrainingNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="Nó de treinamento não encontrado")
    if node.type != "material":
        raise HTTPException(status_code=400, detail="Esta rota conclui apenas materiais; entregue a atividade ou responda o jogo")

    access.ensure_node_access(db, node, current_user, require_unlocked=True)

    return node_service.complete_material_node(db, node, current_user)


@router.post("/{node_id}/submit-game")
def submit_game_score(
    node_id: str,
    submit_req: schemas.GameSubmitRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.type not in {"membro", "trainee"}:
        raise HTTPException(status_code=403, detail="Use a pré-visualização para testar jogos sem alterar o progresso.")
    node = db.query(models.TrainingNode).filter(models.TrainingNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="Nó de treinamento não encontrado")
    if node.type != "game":
        raise HTTPException(status_code=400, detail="Este nó não é um jogo")
    if node.game_revision_id:
        raise HTTPException(status_code=400, detail="Inicie uma tentativa para responder este jogo da biblioteca")

    access.ensure_node_access(db, node, current_user, require_unlocked=True)

    return node_service.submit_game_score(db, node, current_user, submit_req.answers)


@router.patch("/{node_id}/order", response_model=schemas.TrainingNodeGraphOut)
def update_node_order(
    node_id: str,
    order_data: schemas.NodeOrderUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_staff),
):
    node = db.query(models.TrainingNode).filter(models.TrainingNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="Nó não encontrado")
    access.ensure_node_eixo_access(current_user, node.eixo)
    access.ensure_contained_in_axis(db, current_user, node)
    node.order_index = order_data.order_index
    db.commit()
    db.refresh(node)
    return node_service.node_to_out(node)
