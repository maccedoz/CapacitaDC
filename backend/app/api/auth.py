"""
api/auth.py — Authentication endpoints (/api/auth/*)

Não há cadastro público: só a gestão cadastra pessoas, pelo painel (POST /api/users).
"""

import hashlib
import math
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.auth import (
    get_password_hash,
    verify_password,
    get_current_user,
    session_token,
)

router = APIRouter()

MAX_FAILED_LOGINS = 5
LOCKOUT = timedelta(minutes=15)
# Conferido quando o e-mail não existe, para a resposta levar o mesmo tempo
# que uma senha errada e não revelar quem tem conta.
_DUMMY_HASH = get_password_hash("capacita-dc-dummy-password")


class LoginRequest(schemas.BaseModel):
    email: str
    password: str


def _wrong_credentials():
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email ou senha incorretos")


def _locked_out(until: datetime, now: datetime):
    minutes = max(1, math.ceil((until - now).total_seconds() / 60))
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail=f"Muitas tentativas de login. Tente de novo em {minutes} minuto{'s' if minutes > 1 else ''}.",
    )


@router.post("/login", response_model=schemas.Token)
def login(login_data: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == login_data.email).first()
    if user is None:
        verify_password(login_data.password, _DUMMY_HASH)
        raise _wrong_credentials()

    now = datetime.now(timezone.utc)
    locked_until = user.locked_until.replace(tzinfo=timezone.utc) if user.locked_until else None
    if locked_until and locked_until > now:
        raise _locked_out(locked_until, now)

    if not verify_password(login_data.password, user.password_hash):
        user.failed_login_attempts = (user.failed_login_attempts or 0) + 1
        if user.failed_login_attempts >= MAX_FAILED_LOGINS:
            user.failed_login_attempts = 0
            user.locked_until = now + LOCKOUT
            db.commit()
            raise _locked_out(now + LOCKOUT, now)
        db.commit()
        raise _wrong_credentials()

    if user.failed_login_attempts or user.locked_until:
        user.failed_login_attempts = 0
        user.locked_until = None
        db.commit()
    access_token = session_token(user)
    return {"access_token": access_token, "token_type": "bearer", "user": user}


@router.get("/me", response_model=schemas.UserOut)
def read_current_user(current_user: models.User = Depends(get_current_user)):
    return current_user


# ── Meu perfil ────────────────────────────────────────────────────────────────
# Cada pessoa edita só o próprio nome e a própria foto e troca a própria senha.
# E-mail, cargo, eixo e perfil continuam com a gestão.

MAX_PHOTO_SIZE = 2 * 1024 * 1024
PHOTO_TYPES = {"image/jpeg": (b"\xff\xd8\xff",), "image/png": (b"\x89PNG\r\n\x1a\n",)}


def _photo_type(contents: bytes) -> str | None:
    if contents[:4] == b"RIFF" and contents[8:12] == b"WEBP":
        return "image/webp"
    for content_type, signatures in PHOTO_TYPES.items():
        if contents.startswith(signatures):
            return content_type
    return None


@router.patch("/me", response_model=schemas.UserOut)
def update_my_profile(profile: schemas.ProfileUpdate, db: Session = Depends(get_db),
                      current_user: models.User = Depends(get_current_user)):
    current_user.name = profile.name
    db.commit()
    db.refresh(current_user)
    return current_user


@router.post("/me/password", response_model=schemas.Token)
def change_my_password(change: schemas.PasswordChange, db: Session = Depends(get_db),
                       current_user: models.User = Depends(get_current_user)):
    if not verify_password(change.current_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="A senha atual não confere.")
    current_user.password_hash = get_password_hash(change.new_password)
    current_user.password_changed_at = datetime.now(timezone.utc)
    current_user.token_version = (current_user.token_version or 0) + 1
    current_user.password_prompt_pending = False
    db.commit()
    db.refresh(current_user)
    # As outras sessões caem; esta recebe um token novo, emitido depois da troca.
    return {"access_token": session_token(current_user), "token_type": "bearer", "user": current_user}


@router.post("/me/password-prompt/dismiss", response_model=schemas.UserOut)
def dismiss_password_prompt(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    current_user.password_prompt_pending = False
    db.commit()
    db.refresh(current_user)
    return current_user


@router.put("/me/photo", response_model=schemas.UserOut)
async def upload_my_photo(file: UploadFile = File(...), db: Session = Depends(get_db),
                          current_user: models.User = Depends(get_current_user)):
    contents = await file.read()
    if len(contents) > MAX_PHOTO_SIZE:
        raise HTTPException(status_code=413, detail="A foto excede o limite de 2 MB.")
    content_type = _photo_type(contents)
    if content_type is None:
        raise HTTPException(status_code=400, detail="Envie uma imagem JPEG, PNG ou WebP.")
    photo = db.get(models.UserPhoto, current_user.id)
    if photo is None:
        photo = models.UserPhoto(user_id=current_user.id)
        db.add(photo)
    photo.content_type = content_type
    photo.data = contents
    photo.updated_at = datetime.now(timezone.utc)
    # A versão na URL muda a cada foto, então o navegador pode guardar a anterior em cache.
    version = hashlib.sha256(contents).hexdigest()[:12]
    current_user.photo = f"/api/users/{current_user.id}/photo?v={version}"
    db.commit()
    db.refresh(current_user)
    return current_user


@router.delete("/me/photo", response_model=schemas.UserOut)
def delete_my_photo(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    photo = db.get(models.UserPhoto, current_user.id)
    if photo is not None:
        db.delete(photo)
    current_user.photo = ""
    db.commit()
    db.refresh(current_user)
    return current_user
