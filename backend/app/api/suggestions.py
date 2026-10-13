"""
api/suggestions.py — Sugestões e ideias dos trainees (/api/suggestions).

Só trainees enviam, sempre com o nome (não há anonimato). Administradores e
organizadores do PlugInfo leem e marcam como lidas.
"""

import uuid
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.auth import get_current_user

router = APIRouter()

READERS = {"admin", "organizador"}


def _reader(current_user: models.User = Depends(get_current_user)) -> models.User:
    if current_user.type not in READERS:
        raise HTTPException(status_code=403, detail="Só administradores e organizadores leem as sugestões.")
    return current_user


def _trainee(current_user: models.User = Depends(get_current_user)) -> models.User:
    if current_user.type != "trainee":
        raise HTTPException(status_code=403, detail="Só trainees enviam sugestões.")
    return current_user


@router.post("", response_model=schemas.SuggestionOut)
def create_suggestion(suggestion: schemas.SuggestionCreate, db: Session = Depends(get_db),
                      current_user: models.User = Depends(_trainee)):
    created = models.Suggestion(
        id=str(uuid.uuid4()), author_id=current_user.id, author_name=current_user.name,
        text=suggestion.text, created_at=datetime.now(timezone.utc),
    )
    db.add(created)
    db.commit()
    db.refresh(created)
    return created


@router.get("/mine", response_model=List[schemas.SuggestionOut])
def my_suggestions(db: Session = Depends(get_db), current_user: models.User = Depends(_trainee)):
    return (db.query(models.Suggestion).filter(models.Suggestion.author_id == current_user.id)
            .order_by(models.Suggestion.created_at.desc()).all())


@router.get("", response_model=List[schemas.SuggestionOut])
def list_suggestions(db: Session = Depends(get_db), current_user: models.User = Depends(_reader)):
    """Não lidas primeiro, depois as mais recentes."""
    return (db.query(models.Suggestion)
            .order_by(models.Suggestion.read_at.isnot(None), models.Suggestion.created_at.desc()).all())


@router.patch("/{suggestion_id}", response_model=schemas.SuggestionOut)
def mark_suggestion(suggestion_id: str, update: schemas.SuggestionUpdate, db: Session = Depends(get_db),
                    current_user: models.User = Depends(_reader)):
    suggestion = db.get(models.Suggestion, suggestion_id)
    if suggestion is None:
        raise HTTPException(status_code=404, detail="Sugestão não encontrada")
    if update.read:
        suggestion.read_at = suggestion.read_at or datetime.now(timezone.utc)
        suggestion.read_by_id = suggestion.read_by_id or current_user.id
    else:
        suggestion.read_at = None
        suggestion.read_by_id = None
    db.commit()
    db.refresh(suggestion)
    return suggestion
