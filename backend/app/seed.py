"""Cria o administrador inicial, se ainda não existir.

A senha vem de SEED_ADMIN_PASSWORD. Sem ela, o script gera uma senha aleatória
e a mostra uma única vez, ao criar o admin; ela nunca é impressa de novo.
"""
import os
import secrets
import uuid

from app.database import engine, SessionLocal
from app.models import Base, User
from app.auth import get_password_hash

ADMIN_EMAIL = "admin@infojr.com.br"


def seed_db():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    try:
        if db.query(User).filter(User.email == ADMIN_EMAIL).first():
            print(f"✅ Admin '{ADMIN_EMAIL}' já existe no banco.")
            return

        password = os.environ.get("SEED_ADMIN_PASSWORD") or secrets.token_urlsafe(12)
        print("Criando usuário admin...")
        db.add(User(
            id=str(uuid.uuid4()),
            name="Admin",
            email=ADMIN_EMAIL,
            password_hash=get_password_hash(password),
            cargo="Administrador",
            type="admin",
            eixo=None,
            nota_rotacao=None,
            pontos_acumulados=0,
            rotacao=None,
        ))
        db.commit()
        print("✅ Admin criado com sucesso!")
        print(f"   Email: {ADMIN_EMAIL}")
        if os.environ.get("SEED_ADMIN_PASSWORD"):
            print("   Senha: a definida em SEED_ADMIN_PASSWORD")
        else:
            print(f"   Senha gerada (anote, não será mostrada de novo): {password}")
    except Exception as e:
        db.rollback()
        print(f"❌ Erro durante seeding: {e}")
        raise e
    finally:
        db.close()


if __name__ == "__main__":
    seed_db()
