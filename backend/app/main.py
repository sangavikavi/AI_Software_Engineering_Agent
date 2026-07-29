from fastapi import FastAPI, APIRouter, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import text
import logging

from app.core.config import settings
from app.core.database import Base, engine, get_db
from app.models.code import Repository
from app.api.repositories import router as repos_router
from app.api.agents import router as agents_router
from app.api.jira import router as jira_router

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize database tables on module import/app startup
logger.info("Initializing SQLite database schemas...")
Base.metadata.create_all(bind=engine)
logger.info("Database schemas initialized.")

app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json"
)

# Set up CORS middleware
if settings.BACKEND_CORS_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[str(origin) for origin in settings.BACKEND_CORS_ORIGINS],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# Root route
@app.get("/")
def read_root():
    return {"message": "Welcome to the AI SWE Agent Platform API"}

# Health check endpoint
@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "environment": settings.ENVIRONMENT,
        "project": settings.PROJECT_NAME
    }

# Create base API router
api_router = APIRouter()

@api_router.get("/status")
def get_status(db: Session = Depends(get_db)):
    try:
        # Check database connection and count repositories
        repo_count = db.query(Repository).count()
        db_connected = True
    except Exception as e:
        logger.error(f"Database status check failed: {e}")
        repo_count = 0
        db_connected = False

    return {
        "agent_active": False,
        "database_connected": db_connected,
        "repositories_connected": repo_count,
        "running_jobs": 0
    }

# Include routers
app.include_router(api_router, prefix=settings.API_V1_STR)
app.include_router(repos_router, prefix=settings.API_V1_STR)
app.include_router(agents_router, prefix=settings.API_V1_STR)
app.include_router(jira_router, prefix=settings.API_V1_STR)
