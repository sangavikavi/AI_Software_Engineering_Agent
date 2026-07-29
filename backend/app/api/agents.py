import uuid
import logging
import os
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Dict, Any, List, Optional
from datetime import datetime

from app.core.config import settings
from app.core.database import get_db
from app.models.code import Repository
from app.services.vector_store import search_codebase
from app.services.agents import compiled_graph
from app.services.git import clone_repo, create_branch, apply_and_commit_changes, push_branch
from app.services.github import create_pull_request

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agents", tags=["agents"])

# In-memory store for active run states
agent_runs: Dict[str, Dict[str, Any]] = {}

class AgentRunCreate(BaseModel):
    repository_id: int
    instruction: str

class AgentRunStatus(BaseModel):
    run_id: str
    repository_id: int
    instruction: str
    status: str
    plan: List[str]
    current_step_index: int
    proposed_changes: Dict[str, str]
    test_results: Dict[str, Any]
    review_feedback: Dict[str, Any]
    history_logs: List[str]
    iterations: int

# Background workflow manager
def run_agent_workflow(run_id: str, initial_state: Dict[str, Any]) -> None:
    agent_runs[run_id]["status"] = "running"
    
    try:
        # Stream the graph nodes incrementally to intercept updates
        for event in compiled_graph.stream(initial_state):
            # event is e.g. {'planner': {'plan': [...], 'status': 'coding', ...}}
            node_name = list(event.keys())[0]
            node_state = event[node_name]
            
            logger.info(f"Stream update from node '{node_name}': {node_state.keys()}")
            
            # Map state keys to our live status store
            for key, val in node_state.items():
                if key in agent_runs[run_id]:
                    # Update or append list items
                    if isinstance(val, list) and key == "history_logs":
                        agent_runs[run_id][key] = val
                    else:
                        agent_runs[run_id][key] = val
            
            # Align status
            if "status" in node_state:
                agent_runs[run_id]["status"] = node_state["status"]
                
        # Handle final state resolutions
        final_status = agent_runs[run_id]["status"]
        if final_status == "ready":
            agent_runs[run_id]["history_logs"].append("System: Execution paused. Awaiting human review & approval.")
        elif final_status == "failed":
            agent_runs[run_id]["history_logs"].append("System Error: Loop limit exceeded. Graph execution aborted.")
        else:
            # Reached end successfully
            agent_runs[run_id]["status"] = "ready"
            agent_runs[run_id]["history_logs"].append("System: Execution paused. Awaiting human review & approval.")
            
    except Exception as e:
        logger.error(f"Error during LangGraph background execution of run {run_id}: {e}")
        agent_runs[run_id]["status"] = "failed"
        agent_runs[run_id]["history_logs"].append(f"System Error: Graph failed - {str(e)}")

# Routes
@router.post("/run", response_model=Dict[str, str])
def trigger_agent_run(
    run_in: AgentRunCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Launch an autonomous agent run to implement a requirement.
    Retrieves semantic code context, initializes LangGraph, and executes in background.
    """
    repo = db.query(Repository).filter(Repository.id == run_in.repository_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
        
    # 1. Fetch relevant codebase context chunks
    try:
        context_chunks = search_codebase(db, run_in.repository_id, run_in.instruction, top_k=3)
        context = [chunk["content"] for chunk in context_chunks]
    except Exception as e:
        logger.error(f"Failed to query semantic search codebase context: {e}")
        context = []
        
    run_id = str(uuid.uuid4())
    
    # 2. Setup live run data structure
    agent_runs[run_id] = {
        "run_id": run_id,
        "repository_id": run_in.repository_id,
        "instruction": run_in.instruction,
        "status": "idle",
        "plan": [],
        "current_step_index": 0,
        "proposed_changes": {},
        "test_results": {},
        "review_feedback": {},
        "history_logs": [f"System: Starting graph. Ingested {len(context)} codebase context blocks."],
        "iterations": 0
    }
    
    # 3. Create initial state for LangGraph inputs
    initial_state = {
        "repository_id": run_in.repository_id,
        "instruction": run_in.instruction,
        "codebase_context": context,
        "plan": [],
        "current_step_index": 0,
        "proposed_changes": {},
        "test_results": {},
        "review_feedback": {},
        "status": "planning",
        "iterations": 0,
        "history_logs": agent_runs[run_id]["history_logs"]
    }
    
    # 4. Push workflow to background task executor
    background_tasks.add_task(run_agent_workflow, run_id, initial_state)
    
    return {"run_id": run_id}

@router.get("/runs/{run_id}", response_model=AgentRunStatus)
def get_run_status(run_id: str):
    """
    Query the active/historical logs and state of an agent run.
    """
    if run_id not in agent_runs:
        raise HTTPException(status_code=404, detail="Agent run not found")
    return agent_runs[run_id]

@router.post("/runs/{run_id}/approve")
async def approve_run(run_id: str, db: Session = Depends(get_db)):
    """
    Provide human-in-the-loop approval to complete the run and apply changes.
    Executes branch creation, file modification, remote push, and opens Pull Request on GitHub.
    """
    if run_id not in agent_runs:
        raise HTTPException(status_code=404, detail="Agent run not found")
        
    run = agent_runs[run_id]
    if run["status"] != "ready":
        raise HTTPException(status_code=400, detail=f"Cannot approve run in state '{run['status']}'")
        
    repo = db.query(Repository).filter(Repository.id == run["repository_id"]).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
        
    run["status"] = "finished"
    run["history_logs"].append("System: Human approval granted. Performing local and remote Git actions...")
    
    local_path = repo.local_path
    token = settings.GITHUB_TOKEN or None
    
    # Validate local path exists
    if not os.path.exists(local_path):
        # Try cloning first
        run["history_logs"].append(f"System: Local path '{local_path}' not found. Cloning remote repository...")
        clone_success = clone_repo(repo.clone_url, local_path, token)
        if not clone_success:
            run["status"] = "failed"
            run["history_logs"].append("System Error: Git clone failed. Cannot apply proposed changes.")
            raise HTTPException(status_code=500, detail="Git clone failed.")
            
    # Generate unique patch branch
    patch_id = uuid.uuid4().hex[:8]
    branch_name = f"swe-agent/patch-{patch_id}"
    
    # 1. Create Git branch
    if not create_branch(local_path, branch_name):
        run["status"] = "failed"
        run["history_logs"].append("System Error: Failed to create/checkout git branch.")
        raise HTTPException(status_code=500, detail="Failed to create git branch.")
        
    # 2. Write proposed file edits & git commit
    commit_msg = f"feat: SWE patch - {run['instruction']}"
    if not apply_and_commit_changes(local_path, run["proposed_changes"], commit_msg):
        run["status"] = "failed"
        run["history_logs"].append("System Error: Failed to apply and commit code changes.")
        raise HTTPException(status_code=500, detail="Failed to commit changes.")
        
    # 3. Push branch to remote origin
    if not push_branch(local_path, branch_name, token):
        run["status"] = "failed"
        run["history_logs"].append("System Error: Failed to push branch to remote origin.")
        raise HTTPException(status_code=500, detail="Failed to push branch.")
        
    # 4. Open Pull Request on GitHub
    run["history_logs"].append("System: Code successfully pushed to origin. Opening Pull Request...")
    try:
        pr_url = await create_pull_request(
            repo_url=repo.clone_url,
            title=f"SWE Patch: {run['instruction']}",
            body=(
                f"Autonomous patch generated by **AI SWE Agent Platform**.\n\n"
                f"### Requirement\n{run['instruction']}\n\n"
                f"### Modified Files\n"
                + "\n".join([f"- `{f}`" for f in run["proposed_changes"].keys()])
            ),
            head_branch=branch_name,
            base_branch="main",
            token=token
        )
        
        run["history_logs"].append(f"System: Pull Request created successfully! Link: {pr_url}")
        return {
            "message": "Run approved. Changes pushed and Pull Request opened.",
            "pr_url": pr_url,
            "status": "finished"
        }
    except Exception as e:
        run["status"] = "failed"
        run["history_logs"].append(f"System Error: Pull Request creation failed - {str(e)}")
        raise HTTPException(status_code=500, detail=f"PR creation failed: {e}")
