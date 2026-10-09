"""Member-only gamification derived from grades: points, level, achievements and ranking.

Values are recomputed from progress and corrected deliveries. Only notification
acknowledgements are stored, so existing achievements do not flood members with popups.
"""

from collections import defaultdict
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session, selectinload

from app import models
from app.services.access import is_required_step
from app.services.assessment_service import MIN_PASSING_GRADE, effective_grade, normalized_grade
from app.services.node_service import lock_user
from app.services.roles import MEMBER_AXES, normalize_axis

POINTS_PER_GRADE_POINT = 10  # Grade 0–10 becomes 0–100 points per assessment.
LEVELS = [(0, "Iniciante"), (100, "Aprendiz"), (250, "Praticante"), (450, "Competente"),
          (700, "Avançado"), (1000, "Especialista"), (1400, "Mestre")]
CONSISTENT_TARGET = 5


def member_grades(db: Session) -> dict[str, list[float]]:
    """Best game grades and effective delivery grades of every member."""
    grades = defaultdict(list)
    games = db.query(models.UserNodeProgress.user_id, models.UserNodeProgress.grade).join(
        models.TrainingNode, models.TrainingNode.id == models.UserNodeProgress.node_id,
    ).join(models.User, models.User.id == models.UserNodeProgress.user_id).filter(
        models.User.type == "membro", models.TrainingNode.type == "game",
        models.UserNodeProgress.grade.isnot(None),
    )
    for user_id, grade in games:
        grades[user_id].append(grade)
    submissions = db.query(models.ActivitySubmission).join(
        models.User, models.User.id == models.ActivitySubmission.user_id,
    ).filter(models.User.type == "membro")
    for submission in submissions:
        grade = effective_grade(submission)
        if grade is not None:
            grades[submission.user_id].append(grade)
    return grades


def points_for(grades) -> int:
    return round(sum(grades) * POINTS_PER_GRADE_POINT)


def level_for(points: int) -> dict:
    index = max(i for i, (minimum, _) in enumerate(LEVELS) if points >= minimum)
    minimum, name = LEVELS[index]
    following = LEVELS[index + 1][0] if index + 1 < len(LEVELS) else None
    return {"number": index + 1, "name": name, "min_points": minimum, "next_points": following}


def ranking(db: Session, grades: dict[str, list[float]]) -> list[dict]:
    members = db.query(models.User).filter(models.User.type == "membro").all()
    rows = sorted(({"user_id": member.id, "name": member.name, "eixo": normalize_axis(member.eixo),
                    "points": points_for(grades.get(member.id, []))} for member in members),
                  key=lambda row: (-row["points"], row["name"].lower(), row["user_id"]))
    for index, row in enumerate(rows):
        # Ties share a position: 1, 1, 3.
        tied = index and rows[index - 1]["points"] == row["points"]
        row["position"] = rows[index - 1]["position"] if tied else index + 1
        row["level"] = level_for(row["points"])["number"]
    return rows


def _attempt_grade(result) -> float:
    return result["grade"] if "grade" in result else normalized_grade(result["attempt_score"], result["max_score"])


def achievements(db: Session, user: models.User, grades: list[float]) -> list[dict]:
    progress = db.query(models.UserNodeProgress).filter(models.UserNodeProgress.user_id == user.id).all()
    completed = {item.node_id for item in progress if item.completed}
    passed = {item.node_id for item in progress if item.completed and (item.grade or 0) >= MIN_PASSING_GRADE}
    attempts = db.query(models.GameAttempt).filter(
        models.GameAttempt.user_id == user.id, models.GameAttempt.status == "completed",
    ).order_by(models.GameAttempt.completed_at, models.GameAttempt.started_at, models.GameAttempt.id).all()
    failed_nodes = set()
    persistent = False
    for attempt in attempts:
        if not attempt.result:
            continue
        if _attempt_grade(attempt.result) < MIN_PASSING_GRADE:
            failed_nodes.add(attempt.node_id)
        elif attempt.node_id in failed_nodes and attempt.node_id in passed:
            persistent = True

    nodes = db.query(models.TrainingNode).options(selectinload(models.TrainingNode.activity)).all()
    nodes_by_id = {node.id: node for node in nodes}
    revision_ids = {node.game_revision_id for node in nodes if node.game_revision_id}
    revision_ids.update(attempt.game_revision_id for attempt in attempts)
    revision_games = dict(db.query(models.GameRevision.id, models.GameRevision.game_id).filter(
        models.GameRevision.id.in_(revision_ids)).all())

    def game_key(node):
        return ('library', revision_games[node.game_revision_id]) if node.game_revision_id in revision_games else ('legacy', node.id)

    perfect_games = {game_key(nodes_by_id[row.node_id]) for row in progress
                     if row.node_id in nodes_by_id and nodes_by_id[row.node_id].type == 'game' and (row.grade or 0) >= 10}
    first_attempts = {}
    for attempt in sorted(attempts, key=lambda item: (item.started_at, item.id)):
        game_id = revision_games.get(attempt.game_revision_id)
        if game_id and attempt.result:
            first_attempts.setdefault(game_id, attempt)
    first_passes = sum(_attempt_grade(attempt.result) >= MIN_PASSING_GRADE for attempt in first_attempts.values())

    axis = normalize_axis(user.eixo)
    trails = {eixo: [node for node in nodes if node.eixo == eixo and is_required_step(node)] for eixo in MEMBER_AXES}
    trail = trails.get(axis, [])
    done = sum(node.id in completed for node in trail)
    halfway = (len(trail) + 1) // 2
    explored = {nodes_by_id[node_id].eixo for node_id in completed if node_id in nodes_by_id} & MEMBER_AXES
    finished_axes = sum(bool(steps) and all(node.id in completed for node in steps) for steps in trails.values())
    good = sum(grade >= MIN_PASSING_GRADE for grade in grades)

    def item(key, title, description, earned, current=None, target=None):
        entry = {"id": key, "title": title, "description": description, "earned": bool(earned)}
        if target is not None:
            entry["progress"] = {"current": min(current, target), "target": target}
        return entry

    return [
        item("first_step", "Hello, World!", "Concluir a primeira etapa de uma trilha.", completed),
        item("perfect_grade", "Farmou Aura", "Tirar 10 em um jogo ou em uma entrega.", any(grade >= 10 for grade in grades)),
        item("persistent", "Brasileiro não desiste nunca", "Ser aprovado em um jogo depois de uma tentativa abaixo de 7.", persistent),
        item("consistent", "C de uma equação", f"Tirar 7 ou mais em {CONSISTENT_TARGET} avaliações.",
             good >= CONSISTENT_TARGET, good, CONSISTENT_TARGET),
        item("trail_complete", "Zerou o game", "Concluir todas as etapas obrigatórias da trilha do seu eixo.",
             trail and all(node.id in completed for node in trail),
             done, len(trail) or None),
        item("hat_trick", "Hat-trick", "Tirar 10 em 3 jogos diferentes.", len(perfect_games) >= 3, len(perfect_games), 3),
        item("first_try", "Nem precisou de Ctrl+Z", "Tirar 7 ou mais na primeira tentativa em 5 jogos diferentes.",
             first_passes >= 5, first_passes, 5),
        item("halfway", "No meio do caminho tinha uma pedra", "Concluir metade das etapas obrigatórias da trilha do seu eixo.",
             trail and done >= halfway, done, halfway or None),
        item("explorer", "Mochileiro dos eixos", "Concluir ao menos uma etapa em cada um dos três eixos.",
             len(explored) == 3, len(explored), 3),
        item("all_trails", "Avatar: mestre dos três eixos", "Concluir todas as etapas obrigatórias das trilhas dos três eixos.",
             finished_axes == 3, finished_axes, 3),
    ]


def _summary(db: Session, user: models.User) -> dict:
    grades = member_grades(db)
    own = grades.get(user.id, [])
    points = points_for(own)
    rows = ranking(db, grades)
    for row in rows:
        row["is_me"] = row["user_id"] == user.id
    return {
        "points": points, "level": level_for(points), "eixo": normalize_axis(user.eixo),
        "achievements": achievements(db, user, own), "ranking": rows,
    }


def _notification_state(db: Session, user: models.User, entries: list[dict]) -> models.MemberAchievementState:
    state = db.get(models.MemberAchievementState, user.id)
    if state is None:
        state = models.MemberAchievementState(user_id=user.id, initialized_at=datetime.now(timezone.utc),
                                             seen_ids=[entry['id'] for entry in entries if entry['earned']])
        db.add(state)
    return state


def summary(db: Session, user: models.User, seen_ids: list[str] | None = None) -> dict:
    # Uma trava por usuário evita duas primeiras consultas ou confirmações simultâneas
    # sobrescreverem o estado dos avisos (também funciona no servidor sem memória local).
    user = lock_user(db, user.id)
    data = _summary(db, user)
    state = _notification_state(db, user, data['achievements'])
    earned_ids = {entry['id'] for entry in data['achievements'] if entry['earned']}
    if seen_ids is not None:
        if not set(seen_ids) <= earned_ids:
            raise HTTPException(422, "Só é possível confirmar conquistas que você já ganhou.")
        state.seen_ids = sorted(set(state.seen_ids) | set(seen_ids))
    data['new_achievements'] = [entry for entry in data['achievements'] if entry['earned'] and entry['id'] not in state.seen_ids]
    db.commit()
    return data
