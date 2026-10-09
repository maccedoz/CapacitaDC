"""
api/grades.py — Grades, corrections queue and file upload endpoints.
"""

import mimetypes
import uuid
from typing import List, Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Response, UploadFile, File
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.auth import get_current_user, get_current_staff
from app.services import access, blob_storage, material_files
from app.services.activity_service import axis_metrics, submission_to_out
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

@router.get("/grades", response_model=List[schemas.GradeRow])
def get_grades(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_staff),
):
    result = []
    if current_user.type == "gerente":
        # Membros: cada coluna conta apenas a trilha do eixo, inclusive pontos e média.
        # Trainees seguem abaixo com as mesmas linhas que o organizador recebe.
        users = []
        for u in access.managed_users(db, current_user):
            if u.type != "membro":
                users.append(u)
                continue
            result.append(schemas.GradeRow(
                id=u.id, name=u.name, email=u.email, cargo=u.cargo, type=u.type, eixo=u.eixo,
                rotacao=u.rotacao, **axis_metrics(db, u.id, access.followed_eixos(current_user, u)),
            ))
        trainee_nodes = db.query(models.TrainingNode).filter(models.TrainingNode.eixo == "trainee").count()
        total_nodes_map = {u.id: trainee_nodes for u in users}
    elif current_user.type == "organizador":
        users = db.query(models.User).filter(models.User.type == "trainee").all()
        total_nodes_map = {
            u.id: db.query(models.TrainingNode).filter(
                models.TrainingNode.eixo == "trainee"
            ).count()
            for u in users
        }
    else:
        users = db.query(models.User).filter(
            models.User.type.in_(["trainee", "membro"])
        ).all()
        total_nodes_map = {}
        for u in users:
            if u.type == "trainee":
                total_nodes_map[u.id] = db.query(models.TrainingNode).filter(
                    models.TrainingNode.eixo == "trainee"
                ).count()
            else:
                eixo = normalize_axis(u.eixo)
                total_nodes_map[u.id] = db.query(models.TrainingNode).filter(
                    models.TrainingNode.eixo == eixo
                ).count() if eixo in MEMBER_AXES else 0

    for u in users:
        progress = db.query(models.UserNodeProgress).filter(
            models.UserNodeProgress.user_id == u.id,
            models.UserNodeProgress.completed == True,
        ).count()
        subs = db.query(models.ActivitySubmission).filter(
            models.ActivitySubmission.user_id == u.id
        ).all()
        graded = [s for s in subs if s.grade is not None]

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
            nodes_completed=progress,
            nodes_total=total_nodes_map.get(u.id, 0),
            activities_submitted=len(subs),
            activities_graded=len(graded),
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

    rows = query.order_by(
        models.ActivitySubmission.grade.is_(None).desc(),
        models.ActivitySubmission.submitted_at.desc(),
    ).limit(limit).offset(offset).all()
    return [submission_to_out(submission, user=user, activity=activity)
            for submission, activity, user in rows]
