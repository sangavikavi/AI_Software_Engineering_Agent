import os
import logging
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from app.core.config import settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Fallback database configuration
db_url = settings.DATABASE_URL

# If we are running locally outside Docker and the DB URL is pointing to the docker database container "db"
# we fall back to SQLite.
is_in_docker = os.path.exists("/.dockerenv") or os.environ.get("AM_I_IN_A_DOCKER_CONTAINER") is not None

if "db:5432" in db_url and not is_in_docker:
    logger.info("Outside Docker environment: falling back to local SQLite (app.db)")
    db_url = "sqlite:///./app.db"

connect_args = {}
if db_url.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(db_url, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# Dependency to get db session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
