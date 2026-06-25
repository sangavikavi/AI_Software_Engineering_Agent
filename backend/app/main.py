from fastapi import FastAPI, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings

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
def get_status():
    return {
        "agent_active": False,
        "database_connected": True,  # Will verify database query here in Stage 2
        "repositories_connected": 0,
        "running_jobs": 0
    }

app.include_router(api_router, prefix=settings.API_V1_STR)
