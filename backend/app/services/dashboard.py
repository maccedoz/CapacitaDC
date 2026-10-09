"""
services/dashboard.py — Números da aba Dashboards da gestão.

Tudo é calculado a partir das tabelas existentes, em poucas consultas por trilha
(sem consulta por pessoa ou por etapa). A trilha de um eixo de membros conta só os
membros daquele eixo; a de trainees, os trainees. Quem é de outro eixo e fez a
etapa não entra na conta, para o percentual medir o público da própria trilha.
"""

from collections import defaultdict

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app import models
from app.services import access
from app.services.assessment_service import MIN_PASSING_GRADE, normalized_grade
from app.services.node_service import is_effectively_released
from app.services.roles import MEMBER_AXES, normalize_axis

TRAILS = ["trainee", *sorted(MEMBER_AXES, key=["vendas", "conexoes", "experiencia"].index)]


def trails_for(actor: models.User) -> list[str]:
    """Trilhas que o perfil acompanha, na ordem das abas do painel."""
    allowed = access.manageable_eixos(actor)
    return [trail for trail in TRAILS if allowed is None or trail in allowed]


def ensure_trail(actor: models.User, trail: str | None) -> str:
    trails = trails_for(actor)
    if not trails:
        raise HTTPException(status_code=403, detail="Seu perfil não acompanha nenhuma trilha.")
    if trail is None:
        return trails[0]
    if trail not in TRAILS:
        raise HTTPException(status_code=422, detail="Trilha inválida.")
    if trail not in trails:
        raise HTTPException(status_code=403, detail="Você não acompanha esta trilha.")
    return trail


def participants(db: Session, trail: str) -> list[models.User]:
    if trail == "trainee":
        return db.query(models.User).filter(models.User.type == "trainee").order_by(models.User.name).all()
    members = db.query(models.User).filter(models.User.type == "membro").order_by(models.User.name).all()
    # Eixos antigos gravados pelo nome de exibição: normalizados em Python, como no resto do sistema.
    return [member for member in members if normalize_axis(member.eixo) == trail]


def _trail_nodes(db: Session, trail: str) -> list[models.TrainingNode]:
    return (db.query(models.TrainingNode).filter(models.TrainingNode.eixo == trail)
            .order_by(models.TrainingNode.order_index, models.TrainingNode.id).all())


def _progress(db: Session, people: list[models.User], node_ids: list[str]) -> list[models.UserNodeProgress]:
    if not people or not node_ids:
        return []
    return db.query(models.UserNodeProgress).filter(
        models.UserNodeProgress.user_id.in_([person.id for person in people]),
        models.UserNodeProgress.node_id.in_(node_ids),
    ).all()


def overview(db: Session, trail: str) -> dict:
    """Conclusão por etapa liberada e média por jogo de uma trilha."""
    people = participants(db, trail)
    nodes = _trail_nodes(db, trail)
    released = [node for node in nodes if is_effectively_released(node)]
    progress = _progress(db, people, [node.id for node in nodes])

    completed = defaultdict(int)
    grades = defaultdict(list)
    for row in progress:
        if row.completed:
            completed[row.node_id] += 1
        if row.grade is not None:
            grades[row.node_id].append(row.grade)

    revisions = {revision.id: revision for revision in db.query(models.GameRevision).filter(
        models.GameRevision.id.in_([node.game_revision_id for node in nodes if node.game_revision_id])).all()}

    steps = [{
        "node_id": node.id, "name": node.name, "type": node.type,
        "is_required": access.is_required_step(node),
        "completed": completed[node.id], "total": len(people),
        "rate": round(completed[node.id] / len(people), 4) if people else None,
    } for node in released]

    games = []
    for node in nodes:
        if node.type != "game":
            continue
        values = grades[node.id]
        revision = revisions.get(node.game_revision_id)
        games.append({
            "node_id": node.id, "name": node.name,
            "game_title": revision.title if revision else None,
            "per_question": revision is not None,  # quizzes antigos não guardam acerto por questão
            "played": len(values), "total": len(people),
            "average": round(sum(values) / len(values), 2) if values else None,
            "approved_rate": round(sum(value >= MIN_PASSING_GRADE for value in values) / len(values), 4) if values else None,
        })
    # Do jogo mais difícil para o mais fácil; os ainda não jogados por último.
    games.sort(key=lambda game: (game["average"] is None, game["average"] if game["average"] is not None else 0))
    return {"trail": trail, "participants": len(people), "steps": steps, "games": games}


def _item_correct(item: dict) -> bool:
    if "is_correct" in item:
        return bool(item["is_correct"])
    # Cenário: acerta quem escolhe a melhor opção daquele passo.
    return item.get("max_score") is not None and item.get("score") == item.get("max_score")


def question_stats(db: Session, actor: models.User, node_id: str) -> dict:
    """Taxa de acerto por questão ou item de um jogo, pela primeira tentativa concluída
    de cada participante (mede o conhecimento antes de decorar as respostas)."""
    node = db.get(models.TrainingNode, node_id)
    if node is None or node.type != "game":
        raise HTTPException(status_code=404, detail="Jogo não encontrado.")
    trail = ensure_trail(actor, node.eixo)
    if node.eixo != trail:
        raise HTTPException(status_code=403, detail="Você não acompanha esta trilha.")
    if node.game_revision_id is None:
        return {"node_id": node.id, "name": node.name, "available": False, "revisions": []}

    people = {person.id for person in participants(db, trail)}
    attempts = (db.query(models.GameAttempt)
                .filter(models.GameAttempt.node_id == node.id, models.GameAttempt.status == "completed",
                        models.GameAttempt.user_id.in_(people))
                .order_by(models.GameAttempt.started_at, models.GameAttempt.completed_at, models.GameAttempt.id).all())
    first = {}
    for attempt in attempts:
        key = (attempt.user_id, attempt.game_revision_id)
        if key not in first and attempt.result:
            first[key] = attempt

    revisions = {revision.id: revision for revision in db.query(models.GameRevision).filter(
        models.GameRevision.id.in_({attempt.game_revision_id for attempt in first.values()})).all()}
    by_revision: dict[str, dict] = {}
    for attempt in first.values():
        bucket = by_revision.setdefault(attempt.game_revision_id, {"attempts": 0, "grades": [], "items": {}})
        bucket["attempts"] += 1
        result = attempt.result
        grade = result.get("grade")
        if grade is None and result.get("max_score"):
            grade = normalized_grade(result.get("attempt_score", 0), result["max_score"])
        if grade is not None:
            bucket["grades"].append(grade)
        for index, item in enumerate(result.get("feedback") or []):
            key = str(item.get("question_id") or item.get("item_id") or item.get("step_id") or index)
            stats = bucket["items"].setdefault(key, {"id": key, "text": item.get("text") or "", "answers": 0,
                                                     "correct": 0, "score": 0.0, "max_score": 0.0, "order": index})
            stats["answers"] += 1
            stats["correct"] += _item_correct(item)
            stats["score"] += float(item.get("score") or 0)
            stats["max_score"] += float(item.get("max_score") or 0)

    result_revisions = []
    for revision_id, bucket in by_revision.items():
        revision = revisions.get(revision_id)
        items = [{
            "id": stats["id"], "text": stats["text"], "answers": stats["answers"],
            "correct_rate": round(stats["correct"] / stats["answers"], 4),
            # Fração média dos pontos da questão (o acerto parcial dos quizzes entra aqui).
            "score_rate": round(stats["score"] / stats["max_score"], 4) if stats["max_score"] else None,
        } for stats in sorted(bucket["items"].values(), key=lambda value: value["order"])]
        items.sort(key=lambda item: item["correct_rate"])
        result_revisions.append({
            "revision_id": revision_id,
            "version": revision.version if revision else None,
            "title": revision.title if revision else None,
            "attempts": bucket["attempts"],
            "average_first_grade": round(sum(bucket["grades"]) / len(bucket["grades"]), 2) if bucket["grades"] else None,
            "items": items,
        })
    result_revisions.sort(key=lambda revision: revision["version"] or 0, reverse=True)
    return {"node_id": node.id, "name": node.name, "available": True, "revisions": result_revisions}
