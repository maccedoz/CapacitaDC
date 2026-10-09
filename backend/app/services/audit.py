"""
services/audit.py — Histórico de alterações da gestão.

Cada rota que altera algo chama `record(...)` na mesma sessão, antes do commit, para
que alteração e registro entrem (ou falhem) juntos. Participantes entregando ou
jogando não entram aqui: essas ações já têm registro próprio.

Escopo: o registro guarda o eixo do conteúdo, ou o da pessoa afetada ("trainee"
para trainees). Gerentes e organizadores veem os registros dos eixos que podem
gerenciar (`access.manageable_eixos`); o administrador vê tudo.
"""

from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Query

from app import models
from app.services import access
from app.services.roles import normalize_axis


def person_scope(user: models.User | None) -> str | None:
    """Eixo de escopo de uma pessoa: o eixo do membro, "trainee" para trainees."""
    if user is None:
        return None
    if user.type == "trainee":
        return "trainee"
    return normalize_axis(user.eixo)


def changes(before: dict[str, Any], after: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Só os campos que mudaram, como {campo: {"antes": ..., "depois": ...}}.

    A comparação usa os valores já como o JSON guarda: um prazo lido do banco (UTC
    sem fuso) e o mesmo instante vindo da requisição (com fuso) não contam como mudança.
    """
    before, after = _plain(before), _plain(after)
    return {field: {"antes": before.get(field), "depois": value}
            for field, value in after.items() if before.get(field) != value}


def _plain(value: Any) -> Any:
    """Valores que o JSON guarda: datas viram texto ISO em UTC."""
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    if isinstance(value, dict):
        return {key: _plain(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(item) for item in value]
    return value


def record(
    db,
    actor: models.User,
    action: str,
    *,
    entity_type: str,
    entity_id: str | None = None,
    entity_name: str | None = None,
    eixo: str | None = None,
    target: models.User | None = None,
    details: dict[str, Any] | None = None,
) -> models.AuditLog:
    """Acrescenta um registro à sessão (sem commit). Sem `eixo`, usa o da pessoa afetada."""
    entry = models.AuditLog(
        created_at=datetime.now(timezone.utc),
        actor_id=actor.id,
        actor_name=actor.name,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        entity_name=entity_name,
        eixo=eixo if eixo is not None else person_scope(target),
        target_user_id=target.id if target is not None else None,
        target_user_name=target.name if target is not None else None,
        details=_plain(details) if details else None,
    )
    db.add(entry)
    return entry


def visible_to(query: Query, actor: models.User) -> Query:
    """Restringe uma consulta de AuditLog ao que o perfil pode ver."""
    eixos = access.manageable_eixos(actor)
    if eixos is None:
        return query
    return query.filter(models.AuditLog.eixo.in_(eixos))
