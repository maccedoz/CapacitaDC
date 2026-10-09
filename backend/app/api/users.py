"""
api/users.py — User & member management endpoints (/api/users/*)
"""

import uuid
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app import models, schemas
from app.auth import (
    get_password_hash,
    get_current_staff,
    get_current_user,
)
from app.services import access
from app.services.roles import STAFF
from app.services.activity_service import axis_metrics

router = APIRouter()

# O cargo é só o texto exibido; a permissão vem de `type`.
CARGO_LABELS = {
    "membro": "Membro",
    "organizador": "Organizador do PlugInfo",
    "trainee": "Trainee",
    "gerente": "Gerente",
}


def _scoped_to_manager(db: Session, current_user: models.User, user: models.User) -> schemas.UserOut:
    """Totals a manager sees: members count only the manager's axis; trainees, as for organizers."""
    if user.type != "membro":
        return schemas.UserOut.model_validate(user)
    metrics = axis_metrics(db, user.id, access.followed_eixos(current_user, user))
    return schemas.UserOut.model_validate(user).model_copy(update={
        "nota_rotacao": metrics["nota_rotacao"],
        "pontos_acumulados": metrics["pontos_acumulados"],
    })


@router.get("", response_model=List[schemas.UserOut])
@router.get("/", response_model=List[schemas.UserOut], include_in_schema=False)
def get_users(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_staff),
):
    """Only the management panel lists people; participants get nobody's data."""
    if current_user.type == "gerente":
        return [_scoped_to_manager(db, current_user, user) for user in access.managed_users(db, current_user)]
    if current_user.type == "organizador":
        return db.query(models.User).filter(models.User.type == "trainee").all()
    return db.query(models.User).all()


@router.post("", response_model=schemas.UserOut)
@router.post("/", response_model=schemas.UserOut, include_in_schema=False)
def create_member(
    user_in: schemas.UserCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_staff),
):
    if current_user.type == "organizador" and user_in.type != "trainee":
        raise HTTPException(
            status_code=403,
            detail="Acesso não autorizado. Organizadores do PlugInfo só podem cadastrar trainees.",
        )
    eixo = access.validate_user_assignment(current_user, role=user_in.type, eixo=user_in.eixo)
    if current_user.type == "gerente" and user_in.cargo.strip().lower() != user_in.type:
        raise HTTPException(status_code=403, detail="Gerentes cadastram apenas membros do próprio eixo e trainees.")

    if db.query(models.User).filter(models.User.email == user_in.email).first():
        raise HTTPException(status_code=400, detail="Este email já está cadastrado")

    cargo_label = "Gerente" if user_in.type == "gerente" else CARGO_LABELS.get(user_in.cargo, user_in.cargo)

    new_user = models.User(
        id=str(uuid.uuid4()),
        name=user_in.name,
        email=user_in.email,
        password_hash=get_password_hash(user_in.password),
        cargo=cargo_label,
        type=user_in.type,
        eixo=eixo,
        photo="",  # a foto é enviada pela própria pessoa, em Meu perfil
        nota_rotacao=None,
        pontos_acumulados=0,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user


@router.delete("/{user_id}")
def delete_user(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_staff),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if current_user.id == user.id:
        raise HTTPException(status_code=400, detail="Você não pode excluir a sua própria conta")
    if current_user.type == "organizador" and user.type != "trainee":
        raise HTTPException(
            status_code=403,
            detail="Acesso não autorizado. Organizadores do PlugInfo só podem excluir trainees.",
        )
    access.ensure_user_access(current_user, user)

    db.query(models.UserNodeProgress).filter(
        models.UserNodeProgress.user_id == user_id
    ).delete()
    db.query(models.ActivitySubmission).filter(
        models.ActivitySubmission.user_id == user_id
    ).delete()
    db.delete(user)
    db.commit()
    return {"message": "Usuário excluído com sucesso"}


@router.put("/trainees/{trainee_id}", response_model=schemas.UserOut)
def update_trainee(
    trainee_id: str,
    trainee_update: schemas.TraineeUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_staff),
):
    trainee = db.query(models.User).filter(
        models.User.id == trainee_id, models.User.type == "trainee"
    ).first()
    if not trainee:
        raise HTTPException(status_code=404, detail="Trainee não encontrado")
    access.ensure_user_access(current_user, trainee)

    if trainee_update.rotacao is not None:
        if trainee_update.rotacao not in [1, 2]:
            raise HTTPException(status_code=400, detail="Rotação deve ser 1 ou 2")
        trainee.rotacao = trainee_update.rotacao

    db.commit()
    db.refresh(trainee)
    return trainee


@router.put("/{user_id}", response_model=schemas.UserOut)
def update_user(
    user_id: str,
    user_update: schemas.UserUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_staff),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if current_user.type == "organizador" and user.type != "trainee":
        raise HTTPException(
            status_code=403,
            detail="Acesso não autorizado. Organizadores do PlugInfo só podem gerenciar trainees.",
        )
    if (
        current_user.type == "organizador"
        and user_update.type
        and user_update.type != "trainee"
    ):
        raise HTTPException(
            status_code=403,
            detail="Acesso não autorizado. Organizadores só podem manter o perfil como trainee.",
        )

    access.ensure_user_access(current_user, user)
    # O estado final é validado antes de gravar: uma recusa não deixa meia alteração.
    role = user_update.type or user.type
    eixo = access.validate_user_assignment(
        current_user, role=role,
        eixo=user_update.eixo if "eixo" in user_update.model_fields_set else user.eixo,
        current=user,
    )
    if (current_user.type == "gerente" and user_update.cargo is not None
            and user_update.cargo.strip().lower() != (user.cargo or "").strip().lower()):
        raise HTTPException(status_code=403, detail="Gerentes não podem alterar o cargo do membro.")

    if user_update.name is not None:
        user.name = user_update.name
    if user_update.email is not None:
        other = db.query(models.User).filter(
            models.User.email == user_update.email, models.User.id != user_id
        ).first()
        if other:
            raise HTTPException(
                status_code=400, detail="Este email já está sendo utilizado por outro usuário"
            )
        user.email = user_update.email
    if user_update.cargo is not None and current_user.type != "gerente":
        user.cargo = CARGO_LABELS.get(user_update.cargo, user_update.cargo)
    user.type = role
    user.eixo = eixo
    if role == "gerente":
        user.cargo = "Gerente"
    if user_update.password is not None and user_update.password.strip() != "":
        user.password_hash = get_password_hash(user_update.password)
        # Senha definida pela gestão: o popup volta a sugerir a troca no próximo acesso.
        user.password_prompt_pending = True

    db.commit()
    db.refresh(user)
    return user


@router.get("/{user_id}/profile", response_model=schemas.UserProfileOut)
def get_user_profile(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_staff),
):
    target = db.query(models.User).filter(models.User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if current_user.type == "organizador" and target.type != "trainee":
        raise HTTPException(
            status_code=403,
            detail="Organizadores só podem consultar os perfis dos trainees.",
        )

    access.ensure_user_access(current_user, target)
    # Para o gerente, os membros aparecem só com a trilha do eixo dele, inclusive
    # pontos e média; trainees aparecem como o organizador os vê.
    visible_node_eixos = access.followed_eixos(current_user, target)
    scoped = current_user.type == "gerente" and target.type == "membro"
    metrics = axis_metrics(db, target.id, visible_node_eixos) if scoped else {}
    progress_list = db.query(models.UserNodeProgress).filter(
        models.UserNodeProgress.user_id == user_id
    ).all()
    # As etapas do progresso vêm numa só consulta, não uma por linha.
    node_ids = {p.node_id for p in progress_list}
    nodes = {
        node.id: node
        for node in db.query(models.TrainingNode).filter(models.TrainingNode.id.in_(node_ids)).all()
    } if node_ids else {}
    node_progress = []
    for p in progress_list:
        node = nodes.get(p.node_id)
        if node and (visible_node_eixos is None or node.eixo in visible_node_eixos):
            node_progress.append(
                schemas.NodeProgressOut(
                    node_id=node.id,
                    node_name=node.name,
                    node_type=node.type,
                    completed=p.completed,
                    score=p.score, grade=p.grade, weight=node.weight, is_required=node.is_required,
                    completed_at=p.completed_at,
                )
            )

    submissions_query = db.query(models.ActivitySubmission).join(models.Activity).filter(
        models.ActivitySubmission.user_id == user_id
    ).options(selectinload(models.ActivitySubmission.attachments))
    visible_activity_eixos = visible_node_eixos
    if visible_activity_eixos is not None:
        submissions_query = submissions_query.filter(models.Activity.eixo.in_(visible_activity_eixos))
    subs = submissions_query.all()
    activity_submissions = [
        schemas.ActivitySubmissionOut(
            id=sub.id,
            activity_id=sub.activity_id,
            user_id=sub.user_id,
            file_url=sub.file_url,
            links=sub.links or [],
            attachments=sub.attachments,
            comment=sub.comment,
            submitted_at=sub.submitted_at,
            grade=sub.grade, previous_grade=sub.previous_grade,
            effective_grade=max((value for value in (sub.grade, sub.previous_grade) if value is not None), default=None),
            feedback=sub.feedback,
            user_name=target.name,
        )
        for sub in subs
    ]

    return schemas.UserProfileOut(
        id=target.id,
        name=target.name,
        email=target.email,
        cargo=target.cargo,
        type=target.type,
        eixo=target.eixo,
        rotacao=target.rotacao,
        nota_rotacao=metrics.get("nota_rotacao", target.nota_rotacao),
        pontos_acumulados=metrics.get("pontos_acumulados", target.pontos_acumulados),
        node_progress=node_progress,
        activity_submissions=activity_submissions,
    )


@router.get("/{user_id}/photo")
def get_user_photo(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """A própria pessoa e a gestão que pode ver essa pessoa."""
    target = db.get(models.User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if target.id != current_user.id:
        if current_user.type not in STAFF:
            raise HTTPException(status_code=403, detail="Acesso não autorizado.")
        access.ensure_user_access(current_user, target)
    photo = db.get(models.UserPhoto, user_id)
    if photo is None:
        raise HTTPException(status_code=404, detail="Sem foto")
    # A URL tem a versão da foto (?v=...), então ela pode ficar em cache privado.
    return Response(content=photo.data, media_type=photo.content_type,
                    headers={"Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff"})
