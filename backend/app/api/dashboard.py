"""Métricas agregadas das trilhas, com o mesmo escopo da gestão."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import models
from app.auth import get_current_staff
from app.database import get_db
from app.services import dashboard

router = APIRouter()


@router.get("")
def overview(
    trail: str | None = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_staff),
):
    selected = dashboard.ensure_trail(current_user, trail)
    return {**dashboard.overview(db, selected), "trails": dashboard.trails_for(current_user)}


@router.get("/games/{node_id}")
def questions(
    node_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_staff),
):
    return dashboard.question_stats(db, current_user, node_id)
