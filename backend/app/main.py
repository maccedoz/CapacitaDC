"""
main.py — Application entry point.

Responsibilities:
  - Create the FastAPI instance
  - Register middleware
  - Mount static file directories
  - Include all API routers

Business logic lives in app/services/*.py
HTTP routing lives in app/api/*.py
"""

import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.config import settings
from app.database import engine
from app import models  # noqa: F401  (registra os modelos no Base antes das migrações)
from app.api import auth, users, materials, nodes, activities, grades, games, gamification, suggestions, audit
from app.migrations import migrate

# Ensure all tables exist (idempotent — safe to run every startup)
migrate(engine)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("capacita")

app = FastAPI(title="Capacita DC API")

# ── Middleware ────────────────────────────────────────────────────────────────

# O navegador chama a API pela mesma origem (a Vercel roteia /api; no dev, o
# Next faz proxy), então o CORS só é ligado para origens listadas no ambiente.
cors_origins = [origin.strip() for origin in settings.CORS_ORIGINS.split(",") if origin.strip()]
if cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


@app.exception_handler(Exception)
async def log_unhandled_error(request: Request, exc: Exception):
    logger.exception("Erro não tratado em %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Erro interno do servidor."})


@app.middleware("http")
async def no_store(request, call_next):
    """Every response here is dynamic and often per-user: an intermediary
    (the Next.js rewrite proxy, Vercel's edge cache) must never reuse one for
    a later request, e.g. replaying a stale 304 for a login POST."""
    response = await call_next(request)
    # Uma rota pode pedir cache privado explicitamente (fotos de perfil com versão na URL).
    response.headers.setdefault("Cache-Control", "no-store")
    return response

# ── Routers ───────────────────────────────────────────────────────────────────
# Uploaded files are served through app.api.grades (GET /api/uploads/{pathname})
# and app.api.activities, both backed by private Vercel Blob storage — compute
# here is stateless, so there is no local directory to mount.

@app.get("/api/health", tags=["health"])
def health():
    """Confere se a API está no ar e alcança o banco."""
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception:
        logger.exception("Health check: banco indisponível")
        return JSONResponse(status_code=503, content={"status": "erro", "database": "indisponível"})
    return {"status": "ok", "database": "ok"}


app.include_router(auth.router,       prefix="/api/auth",       tags=["auth"])
app.include_router(users.router,      prefix="/api/users",      tags=["users"])
app.include_router(materials.router,  prefix="/api/materials",  tags=["materials"])
app.include_router(nodes.router,      prefix="/api/nodes",      tags=["nodes"])
app.include_router(activities.router, prefix="/api/activities", tags=["activities"])
app.include_router(grades.router,     prefix="/api",            tags=["grades"])
app.include_router(games.router,      prefix="/api",            tags=["games"])
app.include_router(gamification.router, prefix="/api/gamification", tags=["gamification"])
app.include_router(suggestions.router, prefix="/api/suggestions", tags=["suggestions"])
app.include_router(audit.router,      prefix="/api/audit",      tags=["audit"])
