from pydantic_settings import BaseSettings
from typing import List

class Settings(BaseSettings):
    PROJECT_NAME: str = "AI SWE Agent Platform"
    API_V1_STR: str = "/api/v1"
    DATABASE_URL: str = "postgresql://postgres:postgres@db:5432/swe_agent_db"
    ENVIRONMENT: str = "development"
    GITHUB_TOKEN: str = ""
    
    # CORS Origins allowed to talk to the backend
    BACKEND_CORS_ORIGINS: List[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
    ]

    class Config:
        case_sensitive = True
        env_file = ".env"

settings = Settings()
