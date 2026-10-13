"""
api/gamification.py — Points, level, achievements and ranking, for members only.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app import models
from app.auth import get_current_user
from app.database import get_db
from app.services import gamification

router = APIRouter()


class SeenAchievements(BaseModel):
    model_config = ConfigDict(extra="forbid")
    achievement_ids: list[str] = Field(min_length=1, max_length=10)


def _ensure_member(user: models.User):
    if user.type != "membro":
        raise HTTPException(403, "A gamificação é exclusiva para membros.")


@router.get("")
def member_gamification(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    _ensure_member(current_user)
    return gamification.summary(db, current_user)


@router.post("/seen")
def acknowledge_achievements(
    payload: SeenAchievements,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    _ensure_member(current_user)
    return gamification.summary(db, current_user, seen_ids=payload.achievement_ids)
