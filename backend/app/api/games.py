"""Reusable game authoring and participant attempt routes."""

from copy import deepcopy
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import game_schemas as schemas, models
from app.auth import get_current_staff, get_current_user
from app.database import get_db
from app.services import access, audit, game_service

router = APIRouter()


def _record_game(db: Session, user: models.User, action: str, game: models.Game, details=None) -> None:
    audit.record(db, user, action, entity_type="game", entity_id=game.id, entity_name=game.title,
                 eixo=game.eixo, details=details)


@router.get("/games/", response_model=list[schemas.GameOut], include_in_schema=False)
@router.get("/games", response_model=list[schemas.GameOut])
def list_games(db: Session = Depends(get_db), user: models.User = Depends(get_current_staff)):
    query = db.query(models.Game)
    manageable = access.manageable_eixos(user)
    if manageable is not None:
        query = query.filter(models.Game.eixo.in_(manageable))
    return [game_service.game_to_out(game) for game in query.order_by(models.Game.updated_at.desc()).all()]


@router.post("/games/", response_model=schemas.GameOut, include_in_schema=False)
@router.post("/games", response_model=schemas.GameOut)
def create_game(payload: schemas.GameCreate, db: Session = Depends(get_db), user: models.User = Depends(get_current_staff)):
    access.ensure_node_eixo_access(user, payload.eixo)
    now = datetime.now(timezone.utc)
    game = models.Game(**payload.model_dump(), created_by=user.id, created_at=now, updated_at=now)
    db.add(game)
    db.flush()
    _record_game(db, user, "game.create", game)
    db.commit()
    db.refresh(game)
    return game_service.game_to_out(game)


@router.get("/games/{game_id}", response_model=schemas.GameOut)
def get_game(game_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_staff)):
    return game_service.game_to_out(game_service.game_for_author(db, game_id, user))


@router.patch("/games/{game_id}", response_model=schemas.GameOut)
def update_game(game_id: str, payload: schemas.GameUpdate, db: Session = Depends(get_db), user: models.User = Depends(get_current_staff)):
    game = game_service.game_for_author(db, game_id, user, lock=True)
    if payload.eixo is not None:
        access.ensure_node_eixo_access(user, payload.eixo)
        if payload.eixo != game.eixo and game.revisions:
            raise HTTPException(409, "Um jogo publicado mantém o eixo; duplique para usar em outro eixo")
    # O histórico registra título e eixo; o conteúdo do rascunho entra só como "editado".
    before = {"título": game.title, "eixo": game.eixo}
    content_before = (game.instructions, game.format, game.config)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(game, field, value)
    game.updated_at = datetime.now(timezone.utc)
    details = audit.changes(before, {"título": game.title, "eixo": game.eixo})
    if (game.instructions, game.format, game.config) != content_before:
        details["rascunho"] = "editado"
    if details:
        _record_game(db, user, "game.update", game, details)
    db.commit()
    db.refresh(game)
    return game_service.game_to_out(game)


@router.delete("/games/{game_id}")
def delete_game(game_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_staff)):
    """A draft deletes freely. A published game deletes too, as long as none of
    its revisions (any version, not just the latest) is still tied to a trail
    step — that step would lose its content along with the deleted revision."""
    game = game_service.game_for_author(db, game_id, user, lock=True)
    revision_ids = [revision.id for revision in game.revisions]
    if revision_ids:
        linked = db.query(models.TrainingNode).filter(
            models.TrainingNode.game_revision_id.in_(revision_ids)
        ).count()
        if linked:
            plural = "s" if linked != 1 else ""
            raise HTTPException(
                409,
                f"Este jogo está em uso na trilha ({linked} etapa{plural}). Remova-o da trilha antes de excluir o jogo.",
            )
        # Defensivo: uma tentativa só existe presa a um nó vivo (excluir o nó já
        # exclui suas tentativas junto), então isto não deveria disparar nunca —
        # protege mesmo assim contra um dado órfão de uma versão anterior.
        attempts = db.query(models.GameAttempt).filter(
            models.GameAttempt.game_revision_id.in_(revision_ids)
        ).count()
        if attempts:
            raise HTTPException(409, "Este jogo tem tentativas registradas e não pode ser excluído.")
    _record_game(db, user, "game.delete", game, {"versões": len(revision_ids)} if revision_ids else None)
    db.delete(game)
    db.commit()
    return {"detail": "Jogo excluído com sucesso"}


@router.post("/games/{game_id}/duplicate", response_model=schemas.GameOut)
def duplicate_game(game_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_staff)):
    original = game_service.game_for_author(db, game_id, user)
    now = datetime.now(timezone.utc)
    game = models.Game(title=original.title[:192] + " (cópia)", instructions=original.instructions,
                       eixo=original.eixo, format=original.format, config=deepcopy(original.config),
                       created_by=user.id, created_at=now, updated_at=now)
    db.add(game)
    db.flush()
    _record_game(db, user, "game.duplicate", game, {"origem": original.title})
    db.commit()
    db.refresh(game)
    return game_service.game_to_out(game)


@router.post("/games/{game_id}/publish", response_model=schemas.GameOut)
def publish_game(game_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_staff)):
    game = game_service.game_for_author(db, game_id, user, lock=True)
    return game_service.publish_game(db, game, user)


@router.get("/games/{game_id}/revisions", response_model=list[schemas.RevisionOut])
def list_revisions(game_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_staff)):
    return game_service.game_for_author(db, game_id, user).revisions


@router.post("/nodes/{node_id}/attempts")
def begin_attempt(node_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return game_service.begin_attempt(db, node_id, user)


@router.get("/game-attempts/{attempt_id}")
def read_attempt(attempt_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return game_service.read_attempt(db, attempt_id, user)


@router.post("/game-attempts/{attempt_id}/answers")
def answer_scenario(attempt_id: str, payload: schemas.ScenarioAnswer, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return game_service.answer_scenario(db, attempt_id, user, payload)


@router.post("/game-attempts/{attempt_id}/complete")
def complete_attempt(attempt_id: str, payload: schemas.AttemptComplete, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return game_service.complete_attempt(db, attempt_id, user, payload)
