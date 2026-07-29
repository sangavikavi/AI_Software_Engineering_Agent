from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any

from app.services.jira import create_jira_issue, list_jira_issues

router = APIRouter(prefix="/jira", tags=["jira"])

class JiraIssueCreate(BaseModel):
    summary: str
    description: str

@router.post("/issues", response_model=Dict[str, Any])
async def add_issue(issue_in: JiraIssueCreate):
    """
    Create a new Jira issue/story or append to the local offline JSON fallback database.
    """
    if not issue_in.summary.strip():
        raise HTTPException(status_code=400, detail="Issue summary cannot be empty.")
        
    try:
        issue = await create_jira_issue(issue_in.summary, issue_in.description)
        return issue
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/issues", response_model=List[Dict[str, Any]])
async def get_issues():
    """
    Retrieve all backlog items and stories from Jira Cloud or the local offline JSON database.
    """
    try:
        issues = await list_jira_issues()
        return issues
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
