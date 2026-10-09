from datetime import datetime, timedelta, timezone
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from app.database import get_db
from app.config import settings
from app import models
from app.services.roles import STAFF, manager_axis

# Password hashing configuration
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# OAuth2 scheme for token extraction
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return pwd_context.verify(plain_password, hashed_password)
    except Exception:
        return False

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def session_token(user: models.User) -> str:
    """Token de sessão de uma pessoa, na versão de sessão atual dela."""
    return create_access_token(data={"sub": user.id, "sub_type": "user_id", "ver": user.token_version or 0})


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    now = datetime.now(timezone.utc)
    expire = now + (
        expires_delta if expires_delta is not None
        else timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire, "iat": int(now.timestamp())})
    encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    return encoded_jwt

def get_current_user(token: Optional[str] = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> models.User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Credenciais inválidas ou sessão expirada",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not token:
        raise credentials_exception
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        subject = payload.get("sub")
        if not isinstance(subject, str) or not subject:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    
    # New tokens use an immutable user ID. Email subjects issued before the
    # migration remain accepted until their normal expiration.
    if payload.get("sub_type") == "user_id":
        user = db.query(models.User).filter(models.User.id == subject).first()
    elif "@" in subject:
        user = db.query(models.User).filter(models.User.email == subject).first()
    else:
        user = db.query(models.User).filter(models.User.id == subject).first()
    if user is None:
        raise credentials_exception
    # Quem troca a própria senha derruba as sessões abertas antes da troca: o token
    # carrega a versão da sessão em que foi emitido (tokens antigos, sem ela, são a 0).
    if payload.get("ver", 0) != (user.token_version or 0):
        raise credentials_exception
    return user

def get_current_admin(current_user: models.User = Depends(get_current_user)) -> models.User:
    if current_user.type != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acesso não autorizado. Apenas administradores possuem acesso.",
        )
    return current_user

def get_current_member_or_admin(current_user: models.User = Depends(get_current_user)) -> models.User:
    if current_user.type not in ["admin", "membro"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acesso não autorizado.",
        )
    return current_user

def get_current_organizador_or_admin(current_user: models.User = Depends(get_current_user)) -> models.User:
    if current_user.type not in ["admin", "organizador"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acesso não autorizado. Apenas organizadores ou administradores possuem acesso.",
        )
    return current_user

def get_current_staff(current_user: models.User = Depends(get_current_user)) -> models.User:
    """Entry to the administrative panel. What each role may change is checked per resource.

    A manager whose axis is missing or unknown gets no access at all, never a global one.
    """
    if current_user.type not in STAFF or (current_user.type == "gerente" and manager_axis(current_user) is None):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acesso não autorizado. Seu perfil não tem permissão de gestão.",
        )
    return current_user
