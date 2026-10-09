"""
api/audit.py — Histórico de alterações da gestão (/api/audit).

Só a gestão consulta, e cada perfil vê os registros do próprio escopo
(`services.audit.visible_to`): o administrador vê tudo; o gerente, o eixo dele e
o PlugInfo; o organizador, o PlugInfo.
"""

from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.auth import get_current_staff
from app.services import audit

router = APIRouter()


def _day_start(day: date, utc_offset_minutes: int = 0) -> datetime:
    """Início do dia local convertido em UTC (offset do navegador)."""
    return datetime.combine(day, time.min, tzinfo=timezone.utc) + timedelta(minutes=utc_offset_minutes)


@router.get("", response_model=schemas.AuditPage)
@router.get("/", response_model=schemas.AuditPage, include_in_schema=False)
def list_audit(
    actor_id: str | None = None,
    action: str | None = None,
    entity_type: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    utc_offset_minutes: int = Query(0, ge=-840, le=840),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_staff),
):
    # A lista de pessoas do filtro "quem fez" vem do escopo inteiro, não dos filtros.
    actors = audit.visible_to(
        db.query(models.AuditLog.actor_id, func.max(models.AuditLog.actor_name)), current_user,
    ).filter(models.AuditLog.actor_id.isnot(None)).group_by(models.AuditLog.actor_id).all()

    query = audit.visible_to(db.query(models.AuditLog), current_user)
    if actor_id:
        query = query.filter(models.AuditLog.actor_id == actor_id)
    if action:
        query = query.filter(models.AuditLog.action == action)
    if entity_type:
        query = query.filter(models.AuditLog.entity_type == entity_type)
    if date_from:
        query = query.filter(models.AuditLog.created_at >= _day_start(date_from, utc_offset_minutes))
    if date_to:
        query = query.filter(models.AuditLog.created_at < _day_start(date_to + timedelta(days=1), utc_offset_minutes))

    total = query.count()
    items = query.order_by(models.AuditLog.created_at.desc(), models.AuditLog.id.desc()) \
        .offset(offset).limit(limit).all()
    return schemas.AuditPage(
        items=items,
        total=total,
        actors=sorted(({"id": actor, "name": name} for actor, name in actors),
                      key=lambda item: item["name"].lower()),
    )
