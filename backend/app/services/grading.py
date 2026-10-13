"""
services/grading.py — Lançar notas: a mesma checagem e o mesmo registro para a
correção de uma entrega e para a correção em lote.
"""

from datetime import datetime, timezone

from fastapi import HTTPException

from app import models
from app.services import access, audit


def ensure_can_grade(actor: models.User, activity: models.Activity, submission: models.ActivitySubmission) -> None:
    access.ensure_activity_access(actor, activity, manage=True)
    access.ensure_user_access(actor, submission.user)
    if actor.type == "organizador" and (not submission.user or submission.user.type != "trainee"):
        raise HTTPException(status_code=403, detail="Organizadores só podem corrigir entregas de trainees.")


def apply_grade(db, actor: models.User, activity: models.Activity, submission: models.ActivitySubmission,
                grade: float, feedback: str | None, *, batch: bool = False) -> None:
    """Lança a nota, guarda quem corrigiu e registra no histórico (sem commit)."""
    before = {"nota": submission.grade, "feedback": submission.feedback or ""}
    submission.grade = grade
    submission.feedback = feedback or ""
    submission.graded_by_id = actor.id
    submission.graded_at = datetime.now(timezone.utc)
    details = audit.changes(before, {"nota": submission.grade, "feedback": submission.feedback})
    if batch:
        details["lote"] = True
    audit.record(db, actor, "submission.grade_batch" if batch else "submission.grade",
                 entity_type="submission", entity_id=submission.id, entity_name=activity.title,
                 eixo=activity.eixo, target=submission.user, details=details)
