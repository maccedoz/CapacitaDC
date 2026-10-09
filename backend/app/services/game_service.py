"""Immutable game publications, resumable attempts and authoritative evaluation."""

from copy import deepcopy
from datetime import datetime, timezone
from random import Random

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import update
from sqlalchemy.orm import Session

from app import game_schemas as schemas, models
from app.services import access, audit
from app.services.node_service import ensure_before_node_deadline, lock_progress_user


def game_for_author(db, game_id, user, *, lock=False):
    if lock and db.get_bind().dialect.name == "sqlite":
        db.execute(update(models.Game).where(models.Game.id == game_id).values(
            updated_at=models.Game.updated_at,
        ).execution_options(synchronize_session=False))
    query = db.query(models.Game).filter(models.Game.id == game_id)
    if lock:
        query = query.populate_existing().with_for_update()
    game = query.first()
    if game is None:
        raise HTTPException(404, "Jogo não encontrado")
    access.ensure_node_eixo_access(user, game.eixo)
    if lock:
        access.ensure_contained_in_axis(db, user, game)
    return game


def game_to_out(game):
    result = schemas.GameOut.model_validate(game)
    revision = max(game.revisions, key=lambda item: item.version, default=None)
    if revision:
        result.published_revision = schemas.RevisionOut.model_validate(revision)
        result.has_unpublished_changes = any(
            getattr(game, field) != getattr(revision, field)
            for field in ("title", "instructions", "format", "config")
        )
    return result


def validate_publication(game):
    try:
        return schemas.PUBLICATION_SCHEMAS[game.format].model_validate(game.config).model_dump()
    except ValidationError as exc:
        errors = [".".join(str(part) for part in error["loc"]) + ": " + error["msg"] for error in exc.errors()]
        raise HTTPException(422, "Não foi possível publicar o jogo. " + "; ".join(errors)) from exc


def publish_game(db, game, user):
    config = validate_publication(game)
    # Normalize defaults in the draft too, so publishing an unchanged draft is idempotent.
    game.config = config
    current = game_to_out(game)
    if current.published_revision and not current.has_unpublished_changes:
        return current
    revision = models.GameRevision(
        game_id=game.id,
        version=max((item.version for item in game.revisions), default=0) + 1,
        title=game.title, instructions=game.instructions, format=game.format,
        config=deepcopy(config), max_points=100, published_at=datetime.now(timezone.utc),
    )
    game.revisions.append(revision)
    game.updated_at = datetime.now(timezone.utc)
    # Só uma versão nova entra no histórico: publicar sem mudanças não cria nada.
    audit.record(db, user, "game.publish", entity_type="game", entity_id=game.id, entity_name=game.title,
                 eixo=game.eixo, details={"versão": revision.version})
    db.commit()
    db.refresh(game)
    return game_to_out(game)


def revision_for_node(db, revision_id, eixo, user):
    revision = db.query(models.GameRevision).filter(models.GameRevision.id == revision_id).first()
    if revision is None:
        raise HTTPException(404, "Versão publicada do jogo não encontrada")
    access.ensure_node_eixo_access(user, revision.game.eixo)
    if revision.game.eixo != eixo:
        raise HTTPException(400, "O jogo deve pertencer ao eixo da etapa")
    return revision


def _node_for_attempt(db, node_id, user):
    node = db.query(models.TrainingNode).filter(models.TrainingNode.id == node_id).first()
    if node is None:
        raise HTTPException(404, "Etapa não encontrada")
    access.ensure_node_access(db, node, user, require_unlocked=True)
    if node.type != "game" or not node.game_revision_id:
        raise HTTPException(400, "Esta etapa não contém um jogo da biblioteca")
    if user.type not in {"membro", "trainee"}:
        raise HTTPException(403, "Use a pré-visualização para testar jogos sem alterar o progresso")
    return node


def _attempt_for_user(db, attempt_id, user, *, lock=False):
    if lock:
        user = lock_progress_user(db, user)
    attempt = db.query(models.GameAttempt).filter(models.GameAttempt.id == attempt_id).populate_existing().first()
    if attempt is None:
        raise HTTPException(404, "Tentativa não encontrada")
    if attempt.user_id != user.id:
        raise HTTPException(403, "Esta tentativa pertence a outro participante")
    node = _node_for_attempt(db, attempt.node_id, user)
    if lock and attempt.status != "completed" and not node.allow_retry:
        if db.query(models.GameAttempt).filter_by(user_id=user.id, node_id=node.id, status="completed").first():
            raise HTTPException(409, "Este jogo não permite repetição.")
    return attempt, user


def _scenario_step(attempt):
    config = attempt.revision.config
    current_id = config["start_step_id"]
    steps = {step["id"]: step for step in config["steps"]}
    for answer in attempt.answers:
        option = next(item for item in steps[current_id]["options"] if item["id"] == answer["option_id"])
        current_id = option["next_step_id"]
    return steps[current_id] if current_id is not None else None


def _public_item(item):
    public = {"id": item["id"], "text": item["text"],
              "options": [{"id": option["id"], "text": option["text"]} for option in item["options"]]}
    if "selection" in item:
        public["selection"] = item["selection"]
    return public


def _shuffled(cards, seed):
    """Shuffle by attempt id: the arrangement survives a reload without leaking the key."""
    cards = list(cards)
    Random(f"{seed}:{len(cards)}").shuffle(cards)
    return cards


def _board(attempt):
    config, fmt = attempt.revision.config, attempt.revision.format
    if fmt == "matching":
        rights = ([{"id": card["right_id"], "text": card["right"]} for card in config["pairs"]]
                  + [{"id": card["id"], "text": card["right"]} for card in config["distractors"]])
        return {"left": [{"id": card["id"], "text": card["left"]} for card in config["pairs"]],
                "right": _shuffled(rights, attempt.id)}
    if fmt == "ordering":
        return {"items": _shuffled([{"id": item["id"], "text": item["text"]} for item in config["items"]], attempt.id)}
    if fmt == "categorization":
        return {"categories": [{"id": item["id"], "text": item["text"], "description": item["description"]} for item in config["categories"]],
                "items": _shuffled([{"id": item["id"], "text": item["text"]} for item in config["items"]], attempt.id)}
    return None


def attempt_to_out(attempt):
    revision = attempt.revision
    quiz = revision.format == "quiz"
    scenario = revision.format == "scenario"
    step = _scenario_step(attempt) if scenario and attempt.status != "completed" else None
    result = deepcopy(attempt.result) if attempt.status == "completed" else None
    if result:
        from app.services.assessment_service import min_grade_for, normalized_grade
        result.setdefault("grade", normalized_grade(result["attempt_score"], result["max_score"]))
        progress = next((item for item in attempt.node.progress if item.user_id == attempt.user_id), None)
        result["best_grade"] = progress.grade if progress else result["grade"]
        # Current state, not the one at completion: a later retry may have passed.
        result["min_grade"] = min_grade_for(attempt.node)
        result["step_completed"] = bool(progress and progress.completed)
    return {
        "id": attempt.id, "node_id": attempt.node_id,
        "game_revision_id": revision.id, "status": attempt.status,
        "format": revision.format, "title": revision.title, "instructions": revision.instructions,
        "max_score": revision.max_points,
        "questions": [_public_item(question) for question in revision.config["questions"]] if quiz else [],
        "current_step": _public_item(step) if step else None,
        "board": _board(attempt) if attempt.status != "completed" else None,
        "answers": attempt.answers,
        "can_finish": attempt.status == "in_progress" and (not scenario or step is None),
        "result": result,
    }


def begin_attempt(db, node_id, user):
    user = lock_progress_user(db, user)
    node = _node_for_attempt(db, node_id, user)
    if not node.allow_retry:
        completed = db.query(models.GameAttempt).filter_by(user_id=user.id, node_id=node.id, status="completed").order_by(models.GameAttempt.completed_at.desc()).first()
        if completed:
            return attempt_to_out(completed)
    # Depois do prazo da etapa não se abre nem se retoma tentativa; a melhor nota fica.
    ensure_before_node_deadline(node)
    key = f"{user.id}:{node.id}"
    attempt = db.query(models.GameAttempt).filter(models.GameAttempt.active_key == key).first()
    if attempt is None:
        attempt = models.GameAttempt(
            user_id=user.id, node_id=node.id, game_revision_id=node.game_revision_id,
            active_key=key, status="in_progress", answers=[], started_at=datetime.now(timezone.utc),
        )
        db.add(attempt)
        db.commit()
        db.refresh(attempt)
    return attempt_to_out(attempt)


def read_attempt(db, attempt_id, user):
    attempt, _ = _attempt_for_user(db, attempt_id, user)
    return attempt_to_out(attempt)


def answer_scenario(db, attempt_id, user, answer):
    attempt, _ = _attempt_for_user(db, attempt_id, user, lock=True)
    if attempt.revision.format != "scenario":
        raise HTTPException(400, "Envie as respostas do questionário ao finalizar")
    # Replaying an accepted action never advances twice or changes a past decision.
    previous = next((item for item in attempt.answers if item["step_id"] == answer.step_id), None)
    if previous:
        if previous["option_id"] != answer.option_id:
            raise HTTPException(409, "Este passo já foi respondido; inicie outra tentativa para mudar a decisão")
        return attempt_to_out(attempt)
    if attempt.status != "in_progress":
        raise HTTPException(409, "A tentativa já foi concluída")
    ensure_before_node_deadline(attempt.node)
    step = _scenario_step(attempt)
    if step is None or step["id"] != answer.step_id:
        raise HTTPException(400, "Responda o passo atual do cenário")
    if not any(option["id"] == answer.option_id for option in step["options"]):
        raise HTTPException(400, "A decisão não pertence ao passo atual")
    attempt.answers = [*attempt.answers, answer.model_dump()]
    db.commit()
    db.refresh(attempt)
    return attempt_to_out(attempt)


def _evaluate_quiz(config, answers):
    questions = {question["id"]: question for question in config["questions"]}
    submitted = {answer.question_id: answer.option_ids for answer in answers}
    if len(submitted) != len(answers) or set(submitted) != set(questions):
        raise HTTPException(400, "Responda cada pergunta exatamente uma vez")
    score, maximum, feedback = 0, 0, []
    for question_id, question in questions.items():
        options = {option["id"]: option for option in question["options"]}
        selected = submitted[question_id]
        if len(set(selected)) != len(selected) or not set(selected) <= options.keys():
            raise HTTPException(400, "Alternativas repetidas ou que não pertencem à pergunta")
        if question["selection"] == "single" and len(selected) != 1:
            raise HTTPException(400, "Selecione uma alternativa nas perguntas de escolha única")
        expected = {option["id"] for option in options.values() if option["is_correct"]}
        hits, wrong = len(expected & set(selected)), len(set(selected) - expected)
        correct = set(selected) == expected
        # Partial credit: the question starts at 100% and each error — a wrong option
        # marked or a right one left unmarked — takes 1/(right options) of it, down to 0.
        # Single choice stays 0 or 100%.
        errors = (len(expected) - hits) + wrong
        earned = round(question["weight"] * max(0, 1 - errors / len(expected)), 2)
        score += earned
        maximum += question["weight"]
        feedback.append({
            "question_id": question_id, "text": question["text"], "option_ids": selected,
            "is_correct": correct, "status": "correct" if correct else "partial" if hits else "incorrect",
            "correct_selected": hits, "correct_total": len(expected), "wrong_selected": wrong,
            "score": earned, "max_score": question["weight"],
            "explanation": question["explanation"],
            "feedback": "\n".join(options[option_id]["feedback"] for option_id in selected if options[option_id]["feedback"]),
        })
    return score, maximum, feedback


def _evaluate_scenario(attempt):
    if _scenario_step(attempt) is not None:
        raise HTTPException(400, "Conclua as decisões do cenário antes de finalizar")
    steps = {step["id"]: step for step in attempt.revision.config["steps"]}
    memo = {}

    def best_from(step_id):
        if step_id is None:
            return 0
        if step_id not in memo:
            memo[step_id] = max(option["score"] + best_from(option["next_step_id"]) for option in steps[step_id]["options"])
        return memo[step_id]

    score, feedback = 0, []
    for answer in attempt.answers:
        step = steps[answer["step_id"]]
        option = next(item for item in step["options"] if item["id"] == answer["option_id"])
        score += option["score"]
        feedback.append({"step_id": step["id"], "text": step["text"], "option_ids": [option["id"]],
                         "score": option["score"], "max_score": max(item["score"] for item in step["options"]),
                         "explanation": "", "feedback": option["feedback"]})
    return score, best_from(attempt.revision.config["start_step_id"]), feedback


def _evaluate_matching(config, matches):
    pairs = {card["id"]: card for card in config["pairs"]}
    available = {card["right_id"] for card in config["pairs"]} | {card["id"] for card in config["distractors"]}
    submitted = {match.left_id: match.right_id for match in matches}
    if len(submitted) != len(matches) or set(submitted) != set(pairs):
        raise HTTPException(400, "Relacione cada item exatamente uma vez")
    if not set(submitted.values()) <= available:
        raise HTTPException(400, "A correspondência escolhida não pertence a este jogo")
    if len(set(submitted.values())) != len(submitted):
        raise HTTPException(400, "Cada correspondência só pode ser usada uma vez")
    score, feedback = 0, []
    for left_id, card in pairs.items():
        correct = submitted[left_id] == card["right_id"]
        score += int(correct)
        feedback.append({"item_id": left_id, "text": card["left"], "option_ids": [submitted[left_id]],
                         "is_correct": correct, "score": int(correct), "max_score": 1,
                         "explanation": "" if correct else f"Correspondência correta: {card['right']}",
                         "feedback": card["feedback"]})
    return score, len(pairs), feedback


def _evaluate_ordering(config, order):
    items = {item["id"]: item for item in config["items"]}
    expected = [item["id"] for item in config["items"]]
    if len(set(order)) != len(order) or set(order) != set(items):
        raise HTTPException(400, "Ordene todos os itens exatamente uma vez")
    score, feedback = 0, []
    for position, item_id in enumerate(order):
        correct = expected[position] == item_id
        score += int(correct)
        feedback.append({"item_id": item_id, "text": items[item_id]["text"], "option_ids": [item_id],
                         "is_correct": correct, "score": int(correct), "max_score": 1,
                         "explanation": "" if correct else f"Posição correta: {expected.index(item_id) + 1}ª",
                         "feedback": ""})
    return score, len(expected), feedback


def _evaluate_categorization(config, placements):
    items = {item["id"]: item for item in config["items"]}
    categories = {category["id"]: category for category in config["categories"]}
    submitted = {placement.item_id: placement.category_id for placement in placements}
    if len(submitted) != len(placements) or set(submitted) != set(items):
        raise HTTPException(400, "Classifique cada item exatamente uma vez")
    if not set(submitted.values()) <= set(categories):
        raise HTTPException(400, "A categoria escolhida não pertence a este jogo")
    score, feedback = 0, []
    for item_id, item in items.items():
        correct = submitted[item_id] == item["category_id"]
        score += int(correct)
        feedback.append({"item_id": item_id, "text": item["text"], "option_ids": [submitted[item_id]],
                         "is_correct": correct, "score": int(correct), "max_score": 1,
                         "explanation": "" if correct else f"Categoria correta: {categories[item['category_id']]['text']}",
                         "feedback": item["feedback"]})
    return score, len(items), feedback


# Scenario decisions are recorded step by step, so its completion carries no list.
FORMAT_PAYLOAD = {"quiz": "answers", "scenario": None, "matching": "matches",
                  "ordering": "order", "categorization": "placements"}


def complete_attempt(db: Session, attempt_id, user, payload):
    attempt, user = _attempt_for_user(db, attempt_id, user, lock=True)
    if attempt.status == "completed":
        return attempt_to_out(attempt)
    ensure_before_node_deadline(attempt.node)
    fmt = attempt.revision.format
    expected = FORMAT_PAYLOAD[fmt]
    if payload.submitted_fields() - ({expected} if expected else set()):
        raise HTTPException(400, "Envie apenas as respostas deste formato de jogo")
    config, note = attempt.revision.config, ""
    if fmt == "quiz":
        score, maximum, feedback = _evaluate_quiz(config, payload.answers)
    elif fmt == "scenario":
        score, maximum, feedback = _evaluate_scenario(attempt)
    elif fmt == "matching":
        score, maximum, feedback = _evaluate_matching(config, payload.matches)
    elif fmt == "ordering":
        score, maximum, feedback = _evaluate_ordering(config, payload.order)
        note = config["explanation"]
    else:
        score, maximum, feedback = _evaluate_categorization(config, payload.placements)
    if expected:
        attempt.answers = [item if isinstance(item, str) else item.model_dump() for item in getattr(payload, expected)]
    # Every format shares the same 100-point cap, so formats stay comparable
    # regardless of how many questions, decisions or cards the author wrote.
    normalized = int(score * attempt.revision.max_points / maximum + 0.5) if maximum else 0
    progress = db.query(models.UserNodeProgress).filter(
        models.UserNodeProgress.user_id == user.id, models.UserNodeProgress.node_id == attempt.node_id,
    ).first()
    if progress is None:
        progress = models.UserNodeProgress(user_id=user.id, node_id=attempt.node_id, completed=False, score=0)
        db.add(progress)
    delta = max(0, normalized - progress.score)
    progress.score = max(progress.score, normalized)
    user.pontos_acumulados += delta
    attempt.status = "completed"
    attempt.active_key = None
    attempt.completed_at = datetime.now(timezone.utc)
    from app.services.assessment_service import min_grade_for, normalized_grade, passes
    from app.services.activity_service import recompute_user_grade
    grade = normalized_grade(score, maximum)
    progress.grade = max(progress.grade if progress.grade is not None else 0, grade)
    # Below the minimum, a repeatable game keeps the step open until a retry passes.
    if not progress.completed and passes(attempt.node, progress.grade):
        progress.completed = True
        progress.completed_at = datetime.now(timezone.utc)
    attempt.result = {
        "grade": grade, "best_grade": progress.grade,
        "min_grade": min_grade_for(attempt.node), "step_completed": progress.completed,
        "attempt_score": normalized, "max_score": attempt.revision.max_points,
        "score_added": delta, "total_score": progress.score,
        "user_total_points": user.pontos_acumulados, "note": note, "feedback": feedback,
    }
    recompute_user_grade(db, user.id)
    db.commit()
    db.refresh(attempt)
    return attempt_to_out(attempt)
