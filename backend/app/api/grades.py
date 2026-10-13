"""
api/grades.py — Grades, corrections queue and file upload endpoints.
"""

import mimetypes
import uuid
from typing import List, Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Response, UploadFile, File
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app import models, schemas
from app.auth import get_current_user, get_current_staff
from app.services import access, blob_storage, grading, material_files
from app.services.activity_service import axis_metrics_by_user, recompute_users_grades, submission_to_out
from app.services.roles import MEMBER_AXES, normalize_axis

router = APIRouter()

# ── Upload ────────────────────────────────────────────────────────────────────

ALLOWED_EXTENSIONS = {
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
    "png", "jpg", "jpeg", "gif", "webp", "zip", "txt", "csv",
}
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB
MATERIAL_BLOB_PREFIX = "materials"

# Assinaturas (primeiros bytes) esperadas para cada extensão. Os formatos do
# Office novos são ZIP; os antigos (.doc/.xls/.ppt) são OLE2. TXT e CSV não têm
# assinatura e não são conferidos.
_ZIP = (b"PK\x03\x04", b"PK\x05\x06")
_OLE2 = (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",)
FILE_SIGNATURES = {
    "pdf": (b"%PDF-",),
    "png": (b"\x89PNG\r\n\x1a\n",),
    "jpg": (b"\xff\xd8\xff",),
    "jpeg": (b"\xff\xd8\xff",),
    "gif": (b"GIF87a", b"GIF89a"),
    "zip": _ZIP, "docx": _ZIP, "xlsx": _ZIP, "pptx": _ZIP,
    "doc": _OLE2, "xls": _OLE2, "ppt": _OLE2,
}


def matches_signature(ext: str, contents: bytes) -> bool:
    if ext == "webp":
        return contents[:4] == b"RIFF" and contents[8:12] == b"WEBP"
    signatures = FILE_SIGNATURES.get(ext)
    return signatures is None or contents.startswith(signatures)


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_staff),
):
    name = (file.filename or "").replace("\\", "/").rsplit("/", 1)[-1]
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400, detail=f"Tipo de arquivo .{ext} não permitido."
        )

    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="Arquivo muito grande. Limite: 20 MB.")
    if not matches_signature(ext, contents):
        raise HTTPException(
            status_code=400, detail=f"O conteúdo do arquivo não corresponde a um .{ext}."
        )

    safe_name = f"{uuid.uuid4().hex}_{name.replace(' ', '_')}"
    pathname = blob_storage.upload(
        f"{MATERIAL_BLOB_PREFIX}/{safe_name}", contents, content_type=mimetypes.guess_type(name)[0],
    )
    # Até ser vinculado a um material, o arquivo só é visível para quem o enviou.
    try:
        material_files.record_upload(db, current_user, pathname)
        db.commit()
    except Exception:
        db.rollback()
        blob_storage.delete(pathname)
        raise
    return {"url": material_files.upload_url(pathname), "name": file.filename}


@router.get("/uploads/{pathname:path}")
def download_uploaded_file(
    pathname: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Serves material documents, authorized through the material that lists them.

    Knowing the URL is not enough: a participant needs a trail step that reached
    the material, and staff need the material inside their own scope.
    """
    material_files.ensure_file_access(db, current_user, pathname)
    data = blob_storage.download(pathname)
    if data is None:
        raise HTTPException(status_code=404, detail="Arquivo não encontrado")
    content_type = mimetypes.guess_type(pathname)[0] or "application/octet-stream"
    return Response(content=data, media_type=content_type, headers={
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
    })


# ── Grades spreadsheet ────────────────────────────────────────────────────────

def _own_trail_total(user: models.User, node_totals: dict[str, int]) -> int:
    """Etapas da trilha da própria pessoa: PlugInfo para trainees, o eixo para membros."""
    if user.type == "trainee":
        return node_totals.get("trainee", 0)
    eixo = normalize_axis(user.eixo)
    return node_totals.get(eixo, 0) if eixo in MEMBER_AXES else 0


@router.get("/grades", response_model=List[schemas.GradeRow])
def get_grades(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_staff),
):
    result = []
    if current_user.type == "gerente":
        # Membros: cada coluna conta apenas a trilha do eixo, inclusive pontos e média.
        # Trainees seguem abaixo com as mesmas linhas que o organizador recebe.
        users, members = [], []
        for u in access.managed_users(db, current_user):
            (members if u.type == "membro" else users).append(u)
        # Os membros são agrupados pelos eixos acompanhados, para consultar uma vez por grupo.
        groups: dict[frozenset, list[str]] = {}
        for u in members:
            groups.setdefault(frozenset(access.followed_eixos(current_user, u)), []).append(u.id)
        metrics = {}
        for eixos, user_ids in groups.items():
            metrics.update(axis_metrics_by_user(db, user_ids, set(eixos)))
        for u in members:
            result.append(schemas.GradeRow(
                id=u.id, name=u.name, email=u.email, cargo=u.cargo, type=u.type, eixo=u.eixo,
                rotacao=u.rotacao, **metrics[u.id],
            ))
    elif current_user.type == "organizador":
        users = db.query(models.User).filter(models.User.type == "trainee").all()
    else:
        users = db.query(models.User).filter(
            models.User.type.in_(["trainee", "membro"])
        ).all()

    # Contagens agrupadas por pessoa e por eixo, em vez de consultas por linha.
    # O denominador é só a trilha da própria pessoa; o numerador conta toda etapa
    # concluída, em qualquer eixo.
    user_ids = [u.id for u in users]
    node_totals: dict[str, int] = {}
    completed: dict[str, int] = {}
    submitted: dict[str, tuple[int, int]] = {}
    if user_ids:
        node_totals = dict(db.query(
            models.TrainingNode.eixo, func.count(models.TrainingNode.id),
        ).group_by(models.TrainingNode.eixo).all())
        completed = dict(db.query(
            models.UserNodeProgress.user_id, func.count(models.UserNodeProgress.id),
        ).filter(
            models.UserNodeProgress.user_id.in_(user_ids),
            models.UserNodeProgress.completed == True,
        ).group_by(models.UserNodeProgress.user_id).all())
        submitted = {
            user_id: (total, graded)
            for user_id, total, graded in db.query(
                models.ActivitySubmission.user_id,
                func.count(models.ActivitySubmission.id),
                func.count(models.ActivitySubmission.grade),
            ).filter(
                models.ActivitySubmission.user_id.in_(user_ids),
            ).group_by(models.ActivitySubmission.user_id).all()
        }

    for u in users:
        subs_total, subs_graded = submitted.get(u.id, (0, 0))
        result.append(schemas.GradeRow(
            id=u.id,
            name=u.name,
            email=u.email,
            cargo=u.cargo,
            type=u.type,
            eixo=u.eixo,
            rotacao=u.rotacao,
            nota_rotacao=u.nota_rotacao,
            pontos_acumulados=u.pontos_acumulados,
            nodes_completed=completed.get(u.id, 0),
            nodes_total=_own_trail_total(u, node_totals),
            activities_submitted=subs_total,
            activities_graded=subs_graded,
        ))
    return result


# ── Corrections queue ─────────────────────────────────────────────────────────

@router.get("/submissions", response_model=List[schemas.ActivitySubmissionOut])
def list_submissions(
    status: Literal["pending", "graded", "all"] = "all",
    user_type: Literal["trainee", "membro", "all"] = "all",
    eixo: Optional[str] = None,
    activity_id: Optional[str] = None,
    user_id: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_staff),
):
    """Every delivery in one queue, pending first, so nothing waits unnoticed.

    The axis filter uses the set the role may *manage*, not the one it may see: an
    organizer sees the "all" axis but cannot correct in it, and listing those rows
    would fill the queue with lines they cannot save.
    """
    if eixo is not None and eixo not in access.CONTENT_EIXOS:
        raise HTTPException(status_code=422, detail="Eixo de conteúdo inválido.")

    query = db.query(models.ActivitySubmission, models.Activity, models.User).join(
        models.Activity, models.Activity.id == models.ActivitySubmission.activity_id,
    ).join(
        models.User, models.User.id == models.ActivitySubmission.user_id,
    )

    manageable = access.manageable_eixos(current_user)
    if manageable is not None:
        query = query.filter(models.Activity.eixo.in_(manageable))
    # Quem corrige não aparece na própria fila; o organizador só acompanha trainees
    # e o gerente, os membros do próprio eixo — a atividade do eixo não basta.
    visible_types = ["trainee"] if current_user.type == "organizador" else ["trainee", "membro"]
    query = query.filter(models.User.type.in_(visible_types))
    followed = access.managed_user_ids(db, current_user)
    if followed is not None:
        query = query.filter(models.User.id.in_(followed))

    if status == "pending":
        query = query.filter(models.ActivitySubmission.grade.is_(None))
    elif status == "graded":
        query = query.filter(models.ActivitySubmission.grade.isnot(None))
    if user_type != "all":
        query = query.filter(models.User.type == user_type)
    if eixo is not None:
        query = query.filter(models.Activity.eixo == eixo)
    if activity_id is not None:
        query = query.filter(models.ActivitySubmission.activity_id == activity_id)
    if user_id is not None:
        query = query.filter(models.ActivitySubmission.user_id == user_id)

    rows = query.options(
        selectinload(models.ActivitySubmission.graded_by),
        selectinload(models.ActivitySubmission.attachments),
    ).order_by(
        models.ActivitySubmission.grade.is_(None).desc(),
        models.ActivitySubmission.submitted_at.desc(),
    ).limit(limit).offset(offset).all()
    return [submission_to_out(submission, user=user, activity=activity)
            for submission, activity, user in rows]


@router.post("/submissions/grade-batch", response_model=List[schemas.ActivitySubmissionOut])
def grade_submissions_batch(
    batch: schemas.SubmissionBatchGrade,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_staff),
):
    """Lança a mesma nota em várias entregas. Tudo ou nada: se alguma não puder ser
    corrigida por quem pede, nenhuma muda. A média de cada pessoa é recalculada uma vez."""
    ids = list(dict.fromkeys(batch.submission_ids))
    submissions = (db.query(models.ActivitySubmission)
                   .options(selectinload(models.ActivitySubmission.activity), selectinload(models.ActivitySubmission.user))
                   .filter(models.ActivitySubmission.id.in_(ids)).all())
    if len(submissions) != len(ids):
        raise HTTPException(status_code=404, detail="Uma das entregas não foi encontrada.")
    for submission in submissions:
        grading.ensure_can_grade(current_user, submission.activity, submission)
    for submission in submissions:
        grading.apply_grade(db, current_user, submission.activity, submission, batch.grade, batch.feedback, batch=True)
    recompute_users_grades(db, [submission.user_id for submission in submissions])
    db.commit()
    order = {submission_id: index for index, submission_id in enumerate(ids)}
    return [submission_to_out(submission) for submission in sorted(submissions, key=lambda item: order[item.id])]
