"""
api/auth.py — Authentication endpoints (/api/auth/*)

Não há cadastro público: só a gestão cadastra pessoas, pelo painel (POST /api/users).
"""

import math
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.auth import (
    get_password_hash,
    verify_password,
    create_access_token,
    get_current_user,
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
    access_token = create_access_token(data={"sub": user.id, "sub_type": "user_id"})
    return {"access_token": access_token, "token_type": "bearer", "user": user}


@router.get("/me", response_model=schemas.UserOut)
def read_current_user(current_user: models.User = Depends(get_current_user)):
    return current_user
