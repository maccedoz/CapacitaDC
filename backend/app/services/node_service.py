"""
node_service.py — Business logic for training nodes.

Node serialization, visibility and transactional progress updates.
"""

from datetime import datetime, timezone
from typing import List
from sqlalchemy.orm import Session
from sqlalchemy import update
from fastapi import HTTPException

from app import models, schemas
from app.services.access import allowed_node_eixos, chain_of
from app.services.roles import STAFF


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------

def is_effectively_released(node: models.TrainingNode) -> bool:
    """
    Returns True if the node is considered released right now.
    Admin/Organizador bypass checks are handled at the router level.
    """
    if not node.is_released:
        return False
    if node.released_at is None:
        return True  # Released immediately (no scheduled date)
    now = datetime.now(timezone.utc)
    released_at = node.released_at
    if released_at.tzinfo is None:
        released_at = released_at.replace(tzinfo=timezone.utc)
    return released_at <= now


# ---------------------------------------------------------------------------
# Query / listing
# ---------------------------------------------------------------------------

def unlock_map(db: Session, current_user, nodes) -> dict:
    """Quais etapas estão abertas para a pessoa: liberação mais a corrente.

    Uma única fonte para a listagem da trilha e para a visibilidade de conteúdo,
    para as regras não divergirem entre as telas.
    """
    if current_user.type in STAFF:
        return {node.id: True for node in nodes}
    completed = {
        progress.node_id
        for progress in db.query(models.UserNodeProgress).filter(
            models.UserNodeProgress.user_id == current_user.id,
            models.UserNodeProgress.completed.is_(True),
        ).all()
    }
    previous = chain_of(nodes)
    return {
        node.id: (previous[node.id] is None or previous[node.id] in completed)
        and is_effectively_released(node)
        for node in nodes
    }


def open_content_ids(db: Session, current_user) -> tuple[set, set]:
    """Materiais e atividades das etapas que a pessoa já alcançou na trilha.

    Alcançar não é concluir: a etapa atual já libera o próprio material. Só contam
    etapas das trilhas que a pessoa pode ver, e os vínculos são os mesmos da leitura
    da etapa — numa etapa de atividade vale o material da atividade, e uma
    referência direta antiga, substituída por ela, é ignorada.
    """
    query = db.query(models.TrainingNode)
    allowed = allowed_node_eixos(current_user)
    if allowed is not None:
        query = query.filter(models.TrainingNode.eixo.in_(allowed))
    nodes = query.order_by(models.TrainingNode.order_index, models.TrainingNode.id).all()
    unlocked = unlock_map(db, current_user, nodes)
    reached = [node for node in nodes if unlocked[node.id]]
    activity_ids = {node.activity_id or node.reference_id for node in reached
                    if node.type == "activity" or node.activity_id} - {None}
    activities = {
        activity.id: activity
        for activity in db.query(models.Activity).filter(models.Activity.id.in_(activity_ids)).all()
    } if activity_ids else {}

    materials, open_activities = set(), set()
    for node in reached:
        if node.type == "activity" or node.activity_id:
            activity = activities.get(node.activity_id or node.reference_id)
            if activity is None or (allowed is not None and activity.eixo not in allowed):
                continue
            open_activities.add(activity.id)
            if activity.material_id:
                materials.add(activity.material_id)
        elif node.reference_id:
            materials.add(node.reference_id)
    return materials, open_activities


def library_material_ids(db: Session, current_user) -> set | None:
    """Materiais da biblioteca de um participante. None para quem administra.

    Um material só aparece depois de alcançado por pelo menos uma etapa: material
    avulso, ou só ligado a uma atividade fora da trilha, fica restrito à autoria.
    """
    if current_user.type in STAFF:
        return None
    materials, _ = open_content_ids(db, current_user)
    return materials


def blocked_activity_ids(db: Session, current_user) -> set:
    """Atividades que só existem atrás de etapas ainda fechadas.

    Atividade fora da trilha continua visível: nunca esteve presa a uma etapa. Uma
    atividade alcançada por várias etapas aparece se qualquer uma delas estiver aberta.
    """
    if current_user.type in STAFF:
        return set()
    _, open_activities = open_content_ids(db, current_user)
    # Só as colunas do vínculo, de todas as trilhas: uma etapa de outro eixo
    # também prende a atividade.
    linked = {
        activity_id or reference_id
        for node_type, activity_id, reference_id in db.query(
            models.TrainingNode.type, models.TrainingNode.activity_id, models.TrainingNode.reference_id,
        ).all()
        if node_type == "activity" or activity_id
    } - {None}
    return linked - open_activities


def list_nodes_for_user(
    db: Session,
    current_user: models.User,
) -> List[schemas.TrainingNodeGraphOut]:
    """Return nodes visible to the current user, with progress and unlock state."""
    is_privileged = current_user.type in STAFF

    query = db.query(models.TrainingNode)
    allowed = allowed_node_eixos(current_user)
    if allowed is not None:
        query = query.filter(models.TrainingNode.eixo.in_(allowed))
    nodes = query.order_by(models.TrainingNode.order_index, models.TrainingNode.id).all()

    previous_in_eixo = chain_of(nodes)
    unlocked_map = unlock_map(db, current_user, nodes)

    progress_map = {
        p.node_id: p
        for p in db.query(models.UserNodeProgress).filter(
            models.UserNodeProgress.user_id == current_user.id
        ).all()
    }

    result = []
    for node in nodes:
        node_progress = progress_map.get(node.id)
        completed = node_progress.completed if node_progress else False
        user_score = node_progress.score if node_progress else 0

        prerequisite_id = previous_in_eixo.get(node.id)
        unlocked = unlocked_map[node.id]

        result.append(node_to_out(
            node, completed=completed, unlocked=unlocked, user_score=user_score,
            include_answers=is_privileged, effective_prerequisite_id=prerequisite_id,
            grade=node_progress.grade if node_progress else None,
        ))
    return result


def node_to_out(node, *, completed=False, unlocked=True, user_score=0, include_answers=True,
                effective_prerequisite_id=None, grade=None):
    """Use the same contract for list/create/release/order without losing metadata."""
    result = schemas.TrainingNodeGraphOut.model_validate(node)
    result.game_format = node.game_revision.format if node.game_revision else None
    result.effective_prerequisite_id = effective_prerequisite_id or node.prerequisite_node_id
    result.completed = completed
    result.unlocked = unlocked
    result.user_score = user_score
    result.grade = grade
    if node.type == "activity" and node.activity:
        result.allow_retry = node.activity.allow_retry
        result.is_required = node.activity.is_required
        result.weight = node.activity.weight
    if not include_answers:
        if not unlocked:
            result.questions = []
        for question in result.questions:
            question.explanation = None
            for option in question.options:
                option.is_correct = None
                option.score = None
                option.feedback = None
    return result


def lock_user(db, user_id):
    # A stable user row serializes simultaneous writes to the same person: points,
    # the first progress record and the recomputed grade. Refresh after the lock.
    if db.bind.dialect.name == "sqlite":
        db.execute(update(models.User).where(models.User.id == user_id).values(
            pontos_acumulados=models.User.pontos_acumulados,
        ).execution_options(synchronize_session=False))
    return db.query(models.User).filter(models.User.id == user_id).populate_existing().with_for_update().one()


def lock_progress_user(db, current_user):
    return lock_user(db, current_user.id)


# ---------------------------------------------------------------------------
# Progress
# ---------------------------------------------------------------------------

def complete_material_node(
    db: Session,
    node: models.TrainingNode,
    current_user: models.User,
) -> dict:
    """Mark a material node as complete and award 50 points (idempotent)."""
    current_user = lock_progress_user(db, current_user)
    progress = db.query(models.UserNodeProgress).filter(
        models.UserNodeProgress.user_id == current_user.id,
        models.UserNodeProgress.node_id == node.id,
    ).first()

    if not progress:
        progress = models.UserNodeProgress(
            id=__import__("uuid").uuid4().__str__(),
            user_id=current_user.id,
            node_id=node.id,
            completed=True,
            score=0,
            completed_at=datetime.now(timezone.utc),
        )
        db.add(progress)
        current_user.pontos_acumulados += 50
        score_earned = 50
    else:
        score_earned = 0
        if not progress.completed:
            progress.completed = True
            progress.completed_at = datetime.now(timezone.utc)
            current_user.pontos_acumulados += 50
            score_earned = 50

    db.commit()
    return {"detail": "Nó marcado como concluído", "score_earned": score_earned}


def submit_game_score(
    db: Session,
    node: models.TrainingNode,
    current_user: models.User,
    answers: List[schemas.GameAnswer],
) -> dict:
    """Evaluate submitted choices and award only the improvement in the best score."""
    questions = {question.id: question for question in node.questions}
    submitted = {answer.question_id: answer.option_id for answer in answers}
    if not questions or len(submitted) != len(answers) or set(submitted) != set(questions):
        raise HTTPException(status_code=400, detail="Responda cada pergunta do jogo exatamente uma vez")
    score = 0
    max_score = 0
    feedback = []
    for question_id, question in questions.items():
        options = {option.id: option for option in question.options}
        option = options.get(submitted[question_id])
        if option is None:
            raise HTTPException(status_code=400, detail="Alternativa não pertence à pergunta")
        # Existing quizzes may have old negative weights; they cannot remove points.
        option_score = max(0, option.score)
        score += option_score
        max_score += max((max(0, item.score) for item in question.options), default=0)
        feedback.append({
            "question_id": question_id, "option_id": option.id,
            "is_correct": option.is_correct, "score": option_score,
            "feedback": option.feedback or "", "explanation": question.explanation or "",
        })
    import uuid as _uuid

    current_user = lock_progress_user(db, current_user)
    progress = db.query(models.UserNodeProgress).filter(
        models.UserNodeProgress.user_id == current_user.id,
        models.UserNodeProgress.node_id == node.id,
    ).first()

    if progress and progress.completed and not node.allow_retry:
        raise HTTPException(409, "Este jogo não permite repetição.")
    score_added = 0
    if not progress:
        progress = models.UserNodeProgress(
            id=str(_uuid.uuid4()),
            user_id=current_user.id,
            node_id=node.id,
            completed=False,
            score=score,
        )
        db.add(progress)
        score_added = score
        current_user.pontos_acumulados += score_added
    elif score > progress.score:
        score_added = score - progress.score
        current_user.pontos_acumulados += score_added
        progress.score = score

    from app.services.assessment_service import min_grade_for, normalized_grade, passes
    from app.services.activity_service import recompute_user_grade
    # Quizzes antigos sem pesos ainda recebem nota pela proporção de acertos.
    grade = normalized_grade(score, max_score) if max_score else normalized_grade(
        sum(item["is_correct"] for item in feedback), len(feedback))
    progress.grade = max(progress.grade if progress.grade is not None else 0, grade)
    # Abaixo da nota mínima, um jogo repetível mantém a etapa aberta.
    if not progress.completed and passes(node, progress.grade):
        progress.completed = True
        progress.completed_at = datetime.now(timezone.utc)
    recompute_user_grade(db, current_user.id)
    db.commit()
    return {
        "detail": "Nota registrada com sucesso",
        "grade": grade, "best_grade": progress.grade,
        "min_grade": min_grade_for(node), "step_completed": progress.completed,
        "attempt_score": score,
        "max_score": max_score,
        "feedback": feedback,
        "score_added": score_added,
        "total_score": progress.score,
        "user_total_points": current_user.pontos_acumulados,
    }
