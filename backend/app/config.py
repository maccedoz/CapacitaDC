import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str
    JWT_SECRET_KEY: str
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440
    # Origens extras liberadas no CORS, separadas por vírgula. Vazio desliga o CORS:
    # o navegador fala com a API pela mesma origem (Vercel ou proxy do Next).
    CORS_ORIGINS: str = ""

    class Config:
        env_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
        env_file_encoding = "utf-8"

settings = Settings()
