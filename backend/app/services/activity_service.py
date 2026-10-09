"""
activity_service.py — Business logic for activities, submissions and grades.

The rotation grade is not typed by anyone: it is the weighted average of the
submissions already corrected, recomputed here whenever something can change it.
"""

from datetime import datetime, timezone
from typing import Iterable

from sqlalchemy.orm import Session

from app import models, schemas
from app.services.node_service import lock_user
from app.services.assessment_service import effective_grade


def is_effectively_open(activity: models.Activity) -> bool:
    """Returns True if the activity is currently open (manual flag AND deadline not passed)."""
    if not activity.is_open:
        return False
    if activity.deadline is None:
        return True
    now = datetime.now(timezone.utc)
    deadline = activity.deadline
    if deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=timezone.utc)
    return deadline > now


# ---------------------------------------------------------------------------
# Weighted grade
# ---------------------------------------------------------------------------

def normalize_weight(value) -> float:
    """A missing weight counts as 1; a negative one cannot subtract from the average.

    Never written as `value or 1.0`: a deliberate weight of 0 must stay 0, meaning
    the activity gets corrected but does not influence the average.
    """
    if value is None:
        return 1.0
    return max(0.0, float(value))


def activity_weight(activity) -> float:
    return normalize_weight(getattr(activity, "weight", None))


def weighted_average(pairs: Iterable[tuple[float, float]]) -> float | None:
    """Average of (grade, weight) pairs, or None when there is nothing to average.

    None is not zero: someone with no corrected submission has no grade yet, and
    showing 0 would read as a failing mark.
    """
    total_weight = 0.0
    total = 0.0
    for grade, weight in pairs:
        total += grade * weight
        total_weight += weight
    if total_weight == 0:
        return None
    return round(total / total_weight, 2)


def _graded_rows(db: Session, owner_filter, eixos: set[str] | None):
    """Entregas e jogos que entram na média, com a mesma regra para uma ou várias pessoas.

    `owner_filter` recebe a coluna de usuário de cada tabela e devolve o filtro.
    """
    submissions = db.query(models.ActivitySubmission, models.Activity).join(
        models.Activity, models.Activity.id == models.ActivitySubmission.activity_id,
    ).filter(owner_filter(models.ActivitySubmission.user_id), models.Activity.is_required.is_(True))
    # A graded game counts even below the minimum grade that concludes its step:
    # the best grade so far is the person's result until a retry improves it.
    games = db.query(models.UserNodeProgress, models.TrainingNode).join(
        models.TrainingNode, models.TrainingNode.id == models.UserNodeProgress.node_id,
    ).filter(owner_filter(models.UserNodeProgress.user_id),
             models.UserNodeProgress.grade.isnot(None), models.TrainingNode.type == "game",
             models.TrainingNode.is_required.is_(True))
    if eixos is not None:
        submissions = submissions.filter(models.Activity.eixo.in_(eixos))
        games = games.filter(models.TrainingNode.eixo.in_(eixos))
    return submissions.all(), games.all()


def graded_pairs(db: Session, user_id: str, eixos: set[str] | None = None) -> list[tuple[float, float]]:
    submissions, games = _graded_rows(db, lambda column: column == user_id, eixos)
    pairs = [(effective_grade(sub), activity_weight(activity)) for sub, activity in submissions
             if effective_grade(sub) is not None]
    return pairs + [(progress.grade, node.weight) for progress, node in games]


def graded_pairs_by_user(
    db: Session, user_ids: Iterable[str], eixos: set[str] | None = None,
) -> dict[str, list[tuple[float, float]]]:
    """`graded_pairs` de várias pessoas com duas consultas, na mesma ordem: entregas, depois jogos."""
    pairs = {user_id: [] for user_id in user_ids}
    if not pairs:
        return pairs
    submissions, games = _graded_rows(db, lambda column: column.in_(pairs), eixos)
    for sub, activity in submissions:
        grade = effective_grade(sub)
        if grade is not None:
            pairs[sub.user_id].append((grade, activity_weight(activity)))
    for progress, node in games:
        pairs[progress.user_id].append((progress.grade, node.weight))
    return pairs


def recompute_user_grade(db: Session, user_id: str) -> float | None:
    """Recompute and store one person's grade. The caller commits.

    Locks the row first: two people correcting the same person at the same time
    would otherwise both read the pre-other-grade set and drop one grade.
    """
    # A sessão do projeto não tem autoflush: sem esta descarga a consulta abaixo
    # leria o estado anterior à nota que acabou de ser atribuída.
    db.flush()
    user = lock_user(db, user_id)
    user.nota_rotacao = weighted_average(graded_pairs(db, user_id))
    return user.nota_rotacao


def recompute_users_grades(db: Session, user_ids: Iterable[str]) -> None:
    for user_id in sorted(set(user_ids)):
        recompute_user_grade(db, user_id)


def recompute_all_grades(db: Session) -> None:
    """Used by the migration backfill, so stored values cannot drift from the formula."""
    for (user_id,) in db.query(models.User.id).all():
        recompute_user_grade(db, user_id)


def graded_user_ids(db: Session, activity_id: str) -> list[str]:
    """Who has a grade on this activity — collect before deleting or reweighting it."""
    rows = db.query(models.ActivitySubmission.user_id).filter(
        models.ActivitySubmission.activity_id == activity_id,
        (models.ActivitySubmission.grade.isnot(None) | models.ActivitySubmission.previous_grade.isnot(None)),
    ).all()
    return [user_id for (user_id,) in rows]


def axis_metrics(db: Session, user_id: str, eixos: set[str]) -> dict:
    """Points, grade and progress counted only inside the given axes.

    A manager follows one trail: showing the global totals would expose results
    from trails they do not administer. Nothing is written — the stored global
    values stay as they are for everyone else.
    """
    return axis_metrics_by_user(db, [user_id], eixos)[user_id]


def axis_metrics_by_user(db: Session, user_ids: Iterable[str], eixos: set[str]) -> dict[str, dict]:
    """`axis_metrics` de várias pessoas nos mesmos eixos, sem consultas por pessoa."""
    user_ids = list(dict.fromkeys(user_ids))
    if not user_ids:
        return {}
    progress = db.query(models.UserNodeProgress, models.TrainingNode).join(
        models.TrainingNode, models.TrainingNode.id == models.UserNodeProgress.node_id,
    ).filter(
        models.UserNodeProgress.user_id.in_(user_ids),
        models.UserNodeProgress.completed.is_(True),
        models.TrainingNode.eixo.in_(eixos),
    ).all()
    submissions = db.query(models.ActivitySubmission.user_id, models.ActivitySubmission.grade).join(
        models.Activity, models.Activity.id == models.ActivitySubmission.activity_id,
    ).filter(
        models.ActivitySubmission.user_id.in_(user_ids),
        models.Activity.eixo.in_(eixos),
    ).all()
    pairs = graded_pairs_by_user(db, user_ids, eixos)
    nodes_total = db.query(models.TrainingNode).filter(models.TrainingNode.eixo.in_(eixos)).count()

    metrics = {
        user_id: {
            "pontos_acumulados": 0,
            "nota_rotacao": weighted_average(pairs[user_id]),
            "nodes_completed": 0,
            "nodes_total": nodes_total,
            "activities_submitted": 0,
            "activities_graded": 0,
        }
        for user_id in user_ids
    }
    for row, node in progress:
        item = metrics[row.user_id]
        # Mesma regra da trilha: material concluído vale 50; jogo, a melhor pontuação.
        item["pontos_acumulados"] += 50 if node.type == "material" else row.score
        item["nodes_completed"] += 1
    for user_id, grade in submissions:
        item = metrics[user_id]
        item["activities_submitted"] += 1
        item["activities_graded"] += grade is not None
    return metrics


# ---------------------------------------------------------------------------
# Serialization
# ---------------------------------------------------------------------------

def submission_to_out(submission, *, user=None, activity=None) -> schemas.ActivitySubmissionOut:
    """One contract for every submission response, so no caller forgets a field."""
    result = schemas.ActivitySubmissionOut.model_validate(submission)
    result.effective_grade = effective_grade(submission)
    person = user if user is not None else submission.user
    if person is not None:
        result.user_name = person.name
        result.user_type = person.type
    subject = activity if activity is not None else submission.activity
    if subject is not None:
        result.activity_title = subject.title
        result.activity_weight = activity_weight(subject)
        result.activity_eixo = subject.eixo
    return result
