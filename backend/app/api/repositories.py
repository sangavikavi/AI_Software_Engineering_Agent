from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel

from app.core.database import get_db
from app.models.code import Repository
from app.services.parser import parse_and_index_repo
from app.services.vector_store import search_codebase

router = APIRouter(prefix="/repositories", tags=["repositories"])

# Pydantic Schemas
class RepoCreate(BaseModel):
    name: str
    clone_url: str
    local_path: Optional[str] = None

class RepoResponse(BaseModel):
    id: int
    name: str
    clone_url: str
    local_path: Optional[str]
    status: str
    created_at: datetime

    class Config:
        from_attributes = True

class SearchResultResponse(BaseModel):
    file_path: str
    start_line: int
    end_line: int
    content: str
    similarity: float

# Routes
@router.post("", response_model=RepoResponse, status_code=201)
def create_repository(repo_in: RepoCreate, db: Session = Depends(get_db)):
    """
    Register a new codebase repository.
    """
    # Check if repo with same name already exists
    existing = db.query(Repository).filter(Repository.clone_url == repo_in.clone_url).first()
    if existing:
        return existing
        
    db_repo = Repository(
        name=repo_in.name,
        clone_url=repo_in.clone_url,
        local_path=repo_in.local_path or f"./clones/{repo_in.name}"
    )
    db.add(db_repo)
    db.commit()
    db.refresh(db_repo)
    return db_repo

@router.get("", response_model=List[RepoResponse])
def list_repositories(db: Session = Depends(get_db)):
    """
    Get all registered repositories.
    """
    return db.query(Repository).all()

@router.get("/{repo_id}", response_model=RepoResponse)
def get_repository(repo_id: int, db: Session = Depends(get_db)):
    """
    Get detailed status of a repository.
    """
    repo = db.query(Repository).filter(Repository.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
    return repo

@router.post("/{repo_id}/index")
def trigger_indexing(
    repo_id: int, 
    background_tasks: BackgroundTasks, 
    db: Session = Depends(get_db)
):
    """
    Trigger codebase parsing and vector embedding index pipeline in the background.
    """
    repo = db.query(Repository).filter(Repository.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
        
    # Check local path. If it does not exist, we will index the repository directory itself for testing!
    # This allows a zero-cloning local development setup if you point local_path to the agent workspace!
    target_path = repo.local_path
    
    # Simple fallback: if target_path is relative, expand it relative to workspace or parent dir
    if not os.path.exists(target_path):
        # Let's check if the folder is in the parent workspace
        # E.g. D:\AI_Software_Engineering_Agent
        parent_workspace = os.path.abspath(os.path.join(os.getcwd(), ".."))
        # If the local_path targets a directory in the workspace, use that!
        local_check = os.path.abspath(target_path)
        if os.path.exists(local_check):
            target_path = local_check
        elif os.path.exists(parent_workspace):
            # Check if this matches repo name
            workspace_sub = os.path.join(parent_workspace, repo.name)
            if os.path.exists(workspace_sub):
                target_path = workspace_sub
            else:
                target_path = parent_workspace
                
    if not os.path.exists(target_path):
        raise HTTPException(
            status_code=400, 
            detail=f"Target indexing path '{repo.local_path}' does not exist locally. Please clone first or specify a valid local folder."
        )

    # Set status to indexing
    repo.status = "indexing"
    db.commit()
    
    # Run the ingestion in background task to avoid HTTP timeout
    background_tasks.add_task(parse_and_index_repo, db, repo_id, target_path)
    
    return {"message": "Codebase indexing pipeline started in the background", "status": "indexing"}

@router.get("/{repo_id}/search", response_model=List[SearchResultResponse])
def search_repository_codebase(
    repo_id: int,
    query: str = Query(..., min_length=1),
    top_k: int = Query(5, ge=1, le=20),
    db: Session = Depends(get_db)
):
    """
    Semantically search the repository codebase files.
    """
    repo = db.query(Repository).filter(Repository.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
        
    if repo.status != "ready":
        raise HTTPException(
            status_code=400, 
            detail=f"Repository codebase index is in state '{repo.status}'. Please wait for indexing to complete."
        )
        
    results = search_codebase(db, repo_id, query, top_k)
    return results

@router.delete("/{repo_id}")
def delete_repository(repo_id: int, db: Session = Depends(get_db)):
    """
    Disconnect and delete a repository, clearing its files, chunks, and embeddings.
    """
    repo = db.query(Repository).filter(Repository.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
        
    try:
        if repo.local_path and os.path.exists(repo.local_path):
            import shutil
            if "clones" in repo.local_path:
                shutil.rmtree(repo.local_path, ignore_errors=True)
    except Exception as e:
        logger.error(f"Failed to clean up cloned folder {repo.local_path}: {e}")

    db.delete(repo)
    db.commit()
    return {"message": "Repository deleted and embeddings cleared successfully."}

import os
