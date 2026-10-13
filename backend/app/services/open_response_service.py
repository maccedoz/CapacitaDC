"""Manual review of immutable open-question attempts, within the manager's scope."""

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import selectinload

from app import models
from app.services import access, audit, game_service
from app.services.node_service import lock_progress_user


def review_to_out(attempt):
    answers = {answer["question_id"]: answer["text"] for answer in attempt.answers}
    grades = {item["question_id"]: item for item in (attempt.result or {}).get("feedback", [])}
    return {
        "id": attempt.id, "node_id": attempt.node_id, "node_name": attempt.node.name,
        "title": attempt.revision.title, "version": attempt.revision.version,
        "eixo": attempt.node.eixo, "user_name": attempt.user.name, "user_type": attempt.user.type,
        "submitted_at": game_service.utc_timestamp(attempt.submitted_at),
        "graded_at": game_service.utc_timestamp(attempt.graded_at),
        "graded_by_name": attempt.graded_by.name if attempt.graded_by else None,
        "grade": (attempt.result or {}).get("grade"),
        "questions": [{**question, "answer": answers.get(question["id"], ""),
                       "grade": grades.get(question["id"], {}).get("grade"),
                       "feedback": grades.get(question["id"], {}).get("feedback", "")}
                      for question in attempt.revision.config["questions"]],
    }


def list_reviews(db, actor, *, status="pending", eixo=None, user_type="all", limit=20, offset=0):
    if eixo is not None and eixo not in access.CONTENT_EIXOS:
        raise HTTPException(422, "Eixo de conteúdo inválido.")
    query = db.query(models.GameAttempt).join(models.GameRevision).join(
        models.TrainingNode, models.TrainingNode.id == models.GameAttempt.node_id,
    ).join(models.User, models.User.id == models.GameAttempt.user_id).filter(
        models.GameRevision.format == "open_response",
        models.GameAttempt.status.in_(["pending_review", "completed"]),
        models.User.type.in_(["trainee", "membro"]),
    )
    manageable = access.manageable_eixos(actor)
    if manageable is not None:
        query = query.filter(models.TrainingNode.eixo.in_(manageable))
    people = access.managed_user_ids(db, actor)
    if people is not None:
        query = query.filter(models.GameAttempt.user_id.in_(people))
    if status != "all":
        query = query.filter(models.GameAttempt.status == ("pending_review" if status == "pending" else "completed"))
    if eixo is not None:
        query = query.filter(models.TrainingNode.eixo == eixo)
    if user_type != "all":
        query = query.filter(models.User.type == user_type)
    rows = query.options(
        selectinload(models.GameAttempt.node), selectinload(models.GameAttempt.revision),
        selectinload(models.GameAttempt.user), selectinload(models.GameAttempt.graded_by),
    ).order_by(
        (models.GameAttempt.status == "pending_review").desc(),
        models.GameAttempt.submitted_at.desc(), models.GameAttempt.id,
    ).limit(limit).offset(offset).all()
    return [review_to_out(attempt) for attempt in rows]


def grade_attempt(db, attempt_id, actor, payload):
    attempt = db.get(models.GameAttempt, attempt_id)
    if attempt is None:
        raise HTTPException(404, "Tentativa não encontrada")
    access.ensure_node_eixo_access(actor, attempt.node.eixo)
    access.ensure_user_access(actor, attempt.user)
    user = lock_progress_user(db, attempt.user)
    attempt = db.query(models.GameAttempt).filter_by(id=attempt_id).populate_existing().with_for_update().one()
    if attempt.revision.format != "open_response" or attempt.status not in {"pending_review", "completed"}:
        raise HTTPException(409, "Somente respostas abertas já enviadas podem ser corrigidas")
    game_service.validate_question_ids(attempt.revision.config, payload.questions)
    grades = {item.question_id: item for item in payload.questions}
    answers = {item["question_id"]: item["text"] for item in attempt.answers}
    score, maximum, feedback = 0, 0, []
    for question in attempt.revision.config["questions"]:
        item = grades[question["id"]]
        weight = question["weight"]
        score += item.grade * weight
        maximum += 10 * weight
        feedback.append({"question_id": question["id"], "text": question["text"],
                         "answer": answers[question["id"]], "grade": item.grade, "option_ids": [],
                         "score": item.grade * weight, "max_score": 10 * weight,
                         "feedback": item.feedback, "explanation": ""})
    before = {"nota": (attempt.result or {}).get("grade"),
              "correção": [{"pergunta": item["question_id"], "nota": item["grade"], "feedback": item["feedback"]}
                           for item in (attempt.result or {}).get("feedback", [])]}
    # Network retries of the same correction do not duplicate audit entries or points.
    if attempt.status == "completed" and feedback == (attempt.result or {}).get("feedback"):
        return review_to_out(attempt)
    game_service.apply_attempt_result(db, attempt, user, score, maximum, feedback,
                                     regrade=attempt.status == "completed")
    attempt.graded_by_id = actor.id
    attempt.graded_at = datetime.now(timezone.utc)
    audit.record(db, actor, "game.grade", entity_type="game", entity_id=attempt.id,
                 entity_name=attempt.revision.title, eixo=attempt.node.eixo, target=user,
                 details=audit.changes(before, {"nota": attempt.result["grade"],
                                                "correção": [{"pergunta": item["question_id"], "nota": item["grade"],
                                                              "feedback": item["feedback"]} for item in feedback]}))
    db.commit()
    db.refresh(attempt)
    return review_to_out(attempt)
