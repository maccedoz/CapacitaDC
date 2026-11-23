"""Shared content visibility and authorization for lists and actions by ID."""

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app import models
from app.services.roles import STAFF, manager_axis, normalize_axis


# PlugInfo é um papel (type="organizador"), não um eixo de conteúdo: quem organiza
# cria e administra o conteúdo dos trainees e não faz atividades.
CONTENT_EIXOS = {"trainee", "vendas", "conexoes", "experiencia", "all"}
MATERIAL_TYPES = {"trainee", "membro"}
_EIXOS_BY_ROLE = {
    "trainee": {"trainee", "all"},
    "membro": {"vendas", "conexoes", "experiencia", "all"},
    "organizador": {"trainee", "all"},
}
_MATERIAL_TYPES_BY_ROLE = {
    "trainee": {"trainee"},
    "membro": {"trainee", "membro"},
    "organizador": {"trainee"},
}
# Ver e gerenciar são conjuntos diferentes: o organizador enxerga o eixo "all",
# mas não pode criar nem corrigir nele.
_MANAGEABLE_EIXOS_BY_ROLE = {
    "organizador": {"trainee"},
}


def _with_manager_axis(user: models.User, by_role: dict) -> set[str]:
    """O gerente acumula o escopo do organizador (PlugInfo) com o do próprio eixo.

    Sem eixo válido ele não recebe nada, nem a parte do PlugInfo: um cadastro
    quebrado nunca amplia o acesso.
    """
    axis = manager_axis(user)
    return {axis} | by_role["organizador"] if axis else set()


def allowed_node_eixos(user: models.User) -> set[str] | None:
    if user.type == "gerente":
        return _with_manager_axis(user, _EIXOS_BY_ROLE)
    return None if user.type == "admin" else _EIXOS_BY_ROLE.get(user.type, set())


def allowed_activity_eixos(user: models.User) -> set[str] | None:
    return allowed_node_eixos(user)


def manageable_eixos(user: models.User) -> set[str] | None:
    """Axes the user may create or correct content in. None means every axis."""
    if user.type == "gerente":
        return _with_manager_axis(user, _MANAGEABLE_EIXOS_BY_ROLE)
    return None if user.type == "admin" else _MANAGEABLE_EIXOS_BY_ROLE.get(user.type, set())


def allowed_material_types(user: models.User) -> set[str] | None:
    if user.type == "gerente":
        # Materiais de membros do eixo e, como o organizador, os de trainees.
        return {"membro"} | _MATERIAL_TYPES_BY_ROLE["organizador"] if manager_axis(user) else set()
    return None if user.type == "admin" else _MATERIAL_TYPES_BY_ROLE.get(user.type, set())


def _ensure_eixo_visible(user: models.User, eixo: str) -> None:
    allowed = allowed_node_eixos(user)
    if allowed is not None and eixo not in allowed:
        raise HTTPException(status_code=403, detail="Você não tem acesso a este conteúdo.")


def ensure_node_eixo_access(user: models.User, eixo: str) -> None:
    """Validate the destination axis for administrative content mutations."""
    if eixo not in CONTENT_EIXOS:
        raise HTTPException(status_code=422, detail="Eixo de conteúdo inválido.")
    allowed = manageable_eixos(user)
    if allowed is not None and eixo not in allowed:
        raise HTTPException(
            status_code=403,
            detail="Você não pode gerenciar conteúdo deste eixo.",
        )


def ensure_activity_access(user: models.User, activity: models.Activity, *, manage: bool = False) -> None:
    if manage:
        ensure_node_eixo_access(user, activity.eixo)
    else:
        _ensure_eixo_visible(user, activity.eixo)


def ensure_material_type_access(user: models.User, material_type: str, *, manage: bool = False) -> None:
    if material_type not in MATERIAL_TYPES:
        raise HTTPException(status_code=422, detail="Tipo de material inválido.")
    if manage and user.type not in STAFF:
        raise HTTPException(status_code=403, detail="Você não pode gerenciar materiais.")
    allowed = allowed_material_types(user)
    if allowed is not None and material_type not in allowed:
        raise HTTPException(status_code=403, detail="Você não tem acesso a este material.")


def ensure_material_access(user: models.User, material, *, manage: bool = False) -> None:
    """Check a stored material or an incoming payload: both carry type and axis.

    The type alone does not isolate managers, since every member material has
    type "membro"; for them the axis must match as well: member materials stay in
    their own axis and trainee (PlugInfo) materials in the "trainee" axis.
    """
    ensure_material_type_access(user, material.type, manage=manage)
    if user.type == "gerente":
        ensure_node_eixo_access(user, material.eixo)
        expected = manager_axis(user) if material.type == "membro" else "trainee"
        if material.eixo != expected:
            raise HTTPException(status_code=403, detail="Você não pode gerenciar conteúdo deste eixo.")


def is_required_step(node: models.TrainingNode) -> bool:
    """Etapa de atividade segue a atividade vinculada; as demais, a própria etapa."""
    subject = node.activity if node.type == "activity" and node.activity else node
    return bool(getattr(subject, "is_required", True))


def chain_of(nodes) -> dict:
    """Pré-requisito efetivo de cada etapa: o escolhido à mão ou a obrigatória anterior do eixo.

    Recebe as etapas já ordenadas por (order_index, id). Etapas opcionais não
    seguram a corrente: a seguinte depende da última obrigatória antes delas.
    """
    previous, last_of_eixo = {}, {}
    for node in nodes:
        previous[node.id] = node.prerequisite_node_id or last_of_eixo.get(node.eixo)
        if is_required_step(node):
            last_of_eixo[node.eixo] = node.id
    return previous


def satisfied_prerequisite_ids(nodes, completed: set[str], now: datetime) -> set[str]:
    """Avançar não é concluir: atividades vencidas e alcançadas deixam de bloquear.

    Só o prazo da etapa conta. A liberação e a corrente anterior continuam
    obrigatórias, inclusive com pré-requisitos explícitos fora da ordem.
    """
    previous = chain_of(nodes)
    expired = set()
    for node in nodes:
        if node.type != "activity" or not node.is_released or node.deadline is None:
            continue
        deadline = node.deadline
        if deadline.tzinfo is None:
            deadline = deadline.replace(tzinfo=timezone.utc)
        released_at = node.released_at
        if released_at is not None and released_at.tzinfo is None:
            released_at = released_at.replace(tzinfo=timezone.utc)
        if deadline <= now and (released_at is None or released_at <= now):
            expired.add(node.id)

    satisfied = set(completed)
    while expired:
        reached = {node_id for node_id in expired
                   if previous[node_id] is None or previous[node_id] in satisfied}
        if not reached:
            break
        satisfied.update(reached)
        expired.difference_update(reached)
    return satisfied


def has_cycle(chain: dict) -> bool:
    """Se seguir os pré-requisitos a partir de alguma etapa volta a ela mesma."""
    for start in chain:
        seen, cursor = set(), start
        while cursor:
            if cursor in seen:
                return True
            seen.add(cursor)
            cursor = chain.get(cursor)
    return False

def effective_prerequisite_id(db: Session, node: models.TrainingNode) -> str | None:
    """A trilha é uma sequência: a etapa obrigatória anterior do mesmo eixo é o pré-requisito.

    Um pré-requisito escolhido à mão continua valendo e se sobrepõe ao implícito.
    Derivar da ordem faz a corrente se refazer sozinha ao reordenar as etapas.
    """
    if node.prerequisite_node_id:
        return node.prerequisite_node_id
    ordered = db.query(models.TrainingNode).filter(
        models.TrainingNode.eixo == node.eixo,
    ).order_by(models.TrainingNode.order_index, models.TrainingNode.id).all()
    return chain_of(ordered).get(node.id)


def ensure_node_access(
    db: Session,
    node: models.TrainingNode,
    user: models.User,
    *,
    require_unlocked: bool = False,
) -> None:
    _ensure_eixo_visible(user, node.eixo)
    if not require_unlocked or user.type in STAFF:
        return
    released_at = node.released_at
    if released_at is not None and released_at.tzinfo is None:
        released_at = released_at.replace(tzinfo=timezone.utc)
    if not node.is_released or (released_at and released_at > datetime.now(timezone.utc)):
        raise HTTPException(status_code=403, detail="Esta etapa ainda não foi liberada.")
    nodes = db.query(models.TrainingNode).filter(
        models.TrainingNode.eixo == node.eixo,
    ).order_by(models.TrainingNode.order_index, models.TrainingNode.id).all()
    prerequisite_id = chain_of(nodes).get(node.id)
    if prerequisite_id:
        completed = {progress.node_id for progress in db.query(models.UserNodeProgress).filter(
            models.UserNodeProgress.user_id == user.id,
            models.UserNodeProgress.completed.is_(True),
        ).all()}
        satisfied = satisfied_prerequisite_ids(nodes, completed, datetime.now(timezone.utc))
        if prerequisite_id not in satisfied:
            raise HTTPException(status_code=403, detail="Conclua a etapa anterior para continuar.")




# ---------------------------------------------------------------------------
# People management
# ---------------------------------------------------------------------------

def can_manage_user(actor: models.User, target: models.User | None) -> bool:
    """Admin manages everyone; organizers, trainees; managers, trainees and members of their axis."""
    if target is None:
        return False
    if actor.type == "admin":
        return True
    if actor.type == "organizador":
        return target.type == "trainee"
    axis = manager_axis(actor)
    if axis is None:
        return False
    return target.type == "trainee" or (target.type == "membro" and normalize_axis(target.eixo) == axis)


def ensure_user_access(actor: models.User, target: models.User | None) -> None:
    if not can_manage_user(actor, target):
        raise HTTPException(status_code=403, detail="Você não pode gerenciar este usuário.")


def managed_users(db: Session, actor: models.User) -> list[models.User]:
    query = db.query(models.User)
    if actor.type == "organizador":
        query = query.filter(models.User.type == "trainee")
    elif actor.type == "gerente":
        # O eixo é comparado em Python: registros antigos guardam o nome de exibição
        # e o lower() do SQLite ignora letras acentuadas.
        query = query.filter(models.User.type.in_(["membro", "trainee"]))
    elif actor.type != "admin":
        return []
    return [user for user in query.all() if can_manage_user(actor, user)]


def managed_user_ids(db: Session, actor: models.User) -> set[str] | None:
    """IDs the actor may follow in queues and spreadsheets. None means everyone."""
    if actor.type == "admin":
        return None
    return {user.id for user in managed_users(db, actor)}


def followed_eixos(actor: models.User, target: models.User) -> set[str] | None:
    """Trails whose progress the actor sees for this person. None means all.

    A manager follows members only in their own axis; trainees are followed as
    the organizer follows them, so both see the same PlugInfo numbers.
    """
    if actor.type == "gerente":
        if target.type == "membro":
            axis = manager_axis(actor)
            return {axis} if axis else set()
        return _EIXOS_BY_ROLE["organizador"]
    return allowed_node_eixos(actor)


def validate_user_assignment(actor: models.User, *, role: str, eixo, current: models.User | None = None) -> str | None:
    """Validate the final role/axis of a user and return the axis to store.

    Runs before any write, so a refused request leaves the row untouched. Managers
    keep members in their own axis and trainees as trainees, like organizers do;
    promoting someone, naming managers or moving people between axes is an
    administrator decision.
    """
    code = normalize_axis(eixo)
    if actor.type == "gerente":
        keeps_role = current is None or role == current.type
        own_member = role == "membro" and code == manager_axis(actor)
        if not keeps_role or not (own_member or role == "trainee"):
            raise HTTPException(
                status_code=403,
                detail="Gerentes mantêm membros no próprio eixo e trainees como trainees. Promoções e transferências ficam com o administrador.",
            )
    if role == "gerente" and code is None:
        raise HTTPException(status_code=422, detail="Escolha o eixo do gerente: Vendas, Conexões ou Experiência do Consumidor.")
    if role == "membro" and code is None:
        # Um eixo antigo que já estava gravado continua como está até o administrador
        # corrigi-lo; um valor novo precisa ser um dos três eixos.
        if current is not None and current.type == "membro" and eixo == current.eixo:
            return current.eixo
        raise HTTPException(status_code=422, detail="Escolha o eixo do membro: Vendas, Conexões ou Experiência do Consumidor.")
    if role in {"membro", "gerente"}:
        return code
    return None


# ---------------------------------------------------------------------------
# Cross-axis containment
# ---------------------------------------------------------------------------

_SHARED_LINK = "Este conteúdo também é usado em outro eixo; peça ao administrador para alterá-lo."


def ensure_contained_in_axis(db: Session, actor: models.User, resource) -> None:
    """Refuse a manager's change whose effects would reach another axis.

    Content created through the API cannot be linked across axes, but older rows
    can share a material, activity or game with another trail. Changing them would
    alter a trail the manager does not administer, so that stays with the admin.
    The manager's trails are their own axis and the trainee (PlugInfo) trail.
    """
    if actor.type != "gerente":
        return
    ensure_node_eixo_access(actor, resource.eixo)
    managed = manageable_eixos(actor)
    nodes = db.query(models.TrainingNode)
    if isinstance(resource, models.Material):
        for activity in db.query(models.Activity).filter(models.Activity.material_id == resource.id).all():
            if activity.eixo not in managed:
                raise HTTPException(status_code=403, detail=_SHARED_LINK)
            ensure_contained_in_axis(db, actor, activity)
        nodes = nodes.filter(models.TrainingNode.reference_id == resource.id)
    elif isinstance(resource, models.Activity):
        nodes = nodes.filter(or_(models.TrainingNode.activity_id == resource.id,
                                 models.TrainingNode.reference_id == resource.id))
    elif isinstance(resource, models.Game):
        nodes = nodes.join(models.GameRevision).filter(models.GameRevision.game_id == resource.id)
    elif isinstance(resource, models.TrainingNode):
        nodes = nodes.filter(models.TrainingNode.prerequisite_node_id == resource.id)
    else:
        raise TypeError(f"Unsupported resource: {type(resource).__name__}")
    if any(node.eixo not in managed for node in nodes.all()):
        raise HTTPException(status_code=403, detail=_SHARED_LINK)


def ensure_no_foreign_submissions(actor: models.User, activity: models.Activity) -> None:
    """Deleting or reweighting an activity changes every grade on it.

    Members see the trails of every member axis, so an activity can hold
    deliveries from people another manager follows.
    """
    if actor.type == "gerente" and any(not can_manage_user(actor, sub.user) for sub in activity.submissions):
        raise HTTPException(
            status_code=403,
            detail="Esta atividade tem entregas de pessoas de outro eixo; peça ao administrador para alterá-la.",
        )
