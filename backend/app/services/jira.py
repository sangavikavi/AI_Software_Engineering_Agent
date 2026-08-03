import os
import json
import base64
import logging
import httpx
from typing import List, Dict, Any, Optional

from app.core.config import settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# File path for local mock database fallback
MOCK_DB_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "jira_issues.json"))

def _initialize_mock_issues() -> List[Dict[str, Any]]:
    """
    Initialize mock issues for development if the local file is not present.
    """
    default_issues = [
        {
            "key": f"{settings.JIRA_PROJECT_KEY}-101",
            "summary": "Fix route path in repositories API",
            "description": "Locate repos_router in app/main.py and ensure the route prefix matches /api/v1/repositories.",
            "status": "Backlog"
        },
        {
            "key": f"{settings.JIRA_PROJECT_KEY}-102",
            "summary": "Implement route for repository search",
            "description": "Create a GET route for /search that returns indexed codebases matching search query strings.",
            "status": "In Progress"
        }
    ]
    
    if not os.path.exists(MOCK_DB_PATH):
        try:
            with open(MOCK_DB_PATH, "w", encoding="utf-8") as f:
                json.dump(default_issues, f, indent=2)
            logger.info(f"Initialized mock Jira issue store at {MOCK_DB_PATH}")
        except Exception as e:
            logger.error(f"Failed to initialize mock Jira store: {e}")
            
    return default_issues

def _read_mock_issues() -> List[Dict[str, Any]]:
    """
    Read mock issues from local JSON file.
    """
    _initialize_mock_issues()
    try:
        with open(MOCK_DB_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Failed to read mock Jira database: {e}")
        return []

def _write_mock_issues(issues: List[Dict[str, Any]]) -> None:
    """
    Persist mock issues to local JSON file.
    """
    try:
        with open(MOCK_DB_PATH, "w", encoding="utf-8") as f:
            json.dump(issues, f, indent=2)
    except Exception as e:
        logger.error(f"Failed to write mock Jira database: {e}")

async def create_jira_issue(title: str, description: str) -> Dict[str, Any]:
    """
    Create a new issue/story in Jira.
    Falls back to saving to a local JSON file if Jira API credentials are not set.
    """
    url = settings.JIRA_URL
    email = settings.JIRA_EMAIL
    token = settings.JIRA_API_TOKEN
    project_key = settings.JIRA_PROJECT_KEY
    
    # 1. Fallback Offline Mode
    if not url or not email or not token:
        logger.warning("Jira credentials not fully configured. Creating issue in local mock database.")
        issues = _read_mock_issues()
        
        # Calculate next numeric ID
        next_id = 101
        if issues:
            try:
                # Extract numbers from project keys like "KAN-102"
                ids = [int(issue["key"].split("-")[-1]) for issue in issues if "-" in issue["key"]]
                if ids:
                    next_id = max(ids) + 1
            except Exception:
                next_id = len(issues) + 101
                
        new_key = f"{project_key}-{next_id}"
        new_issue = {
            "key": new_key,
            "summary": title,
            "description": description,
            "status": "Backlog"
        }
        
        issues.insert(0, new_issue) # Prepend to list
        _write_mock_issues(issues)
        
        return {
            "key": new_key,
            "url": f"https://mock-jira.atlassian.net/browse/{new_key}",
            "summary": title,
            "description": description,
            "status": "Backlog"
        }
        
    # 2. Real Jira REST Client Mode
    api_url = f"{url.rstrip('/')}/rest/api/3/issue"
    
    # Fallback to avoid empty ADF text nodes which fail Jira schema validation
    if not description or not description.strip():
        description = "No description provided."
    
    # Encode base64 token
    auth_str = f"{email}:{token}"
    auth_b64 = base64.b64encode(auth_str.encode("utf-8")).decode("utf-8")
    
    headers = {
        "Authorization": f"Basic {auth_b64}",
        "Accept": "application/json",
        "Content-Type": "application/json"
    }
    
    # Atlassian Document Format for Rich Text Descriptions
    payload = {
        "fields": {
            "project": {
                "key": project_key
            },
            "summary": title,
            "description": {
                "type": "doc",
                "version": 1,
                "content": [
                    {
                        "type": "paragraph",
                        "content": [
                            {
                                "type": "text",
                                "text": description
                            }
                        ]
                    }
                ]
            },
            "issuetype": {
                "name": "Task"
            }
        }
    }
    
    logger.info(f"Creating real Jira issue on {api_url}")
    async with httpx.AsyncClient() as client:
        response = await client.post(api_url, headers=headers, json=payload, timeout=10.0)
        
    if response.status_code == 201:
        data = response.json()
        key = data.get("key", "")
        self_url = data.get("self", "")
        # Format browse URL
        browse_url = f"{url.rstrip('/')}/browse/{key}"
        logger.info(f"Jira issue created successfully: {key}")
        return {
            "key": key,
            "url": browse_url,
            "summary": title,
            "description": description,
            "status": "Backlog"
        }
    else:
        err_msg = f"Failed to create Jira issue ({response.status_code}): {response.text}"
        logger.error(err_msg)
        raise Exception(err_msg)

async def list_jira_issues() -> List[Dict[str, Any]]:
    """
    List all backlog issues for the project.
    Falls back to local JSON persistence if credentials are not configured.
    """
    url = settings.JIRA_URL
    email = settings.JIRA_EMAIL
    token = settings.JIRA_API_TOKEN
    project_key = settings.JIRA_PROJECT_KEY
    
    # 1. Fallback Offline Mode
    if not url or not email or not token:
        logger.info("Retrieving Jira issues from offline local store.")
        return _read_mock_issues()
        
    # 2. Real Jira REST Client Mode
    jql = f"project = {project_key} ORDER BY created DESC"
    api_url = f"{url.rstrip('/')}/rest/api/3/search/jql"
    
    # Encode base64 token
    auth_str = f"{email}:{token}"
    auth_b64 = base64.b64encode(auth_str.encode("utf-8")).decode("utf-8")
    
    headers = {
        "Authorization": f"Basic {auth_b64}",
        "Accept": "application/json"
    }
    
    params = {
        "jql": jql,
        "maxResults": 50,
        "fields": "summary,description,status"
    }
    
    logger.info(f"Fetching issues from Jira via search API: {api_url}")
    async with httpx.AsyncClient() as client:
        response = await client.get(api_url, headers=headers, params=params, timeout=10.0)
        
    if response.status_code == 200:
        data = response.json()
        issues_list = []
        for item in data.get("issues", []):
            fields = item.get("fields", {})
            
            # Parse ADF Description text content
            desc_text = ""
            desc_doc = fields.get("description")
            if isinstance(desc_doc, dict):
                try:
                    for p in desc_doc.get("content", []):
                        for text_node in p.get("content", []):
                            if text_node.get("type") == "text":
                                desc_text += text_node.get("text", "")
                except Exception:
                    desc_text = str(desc_doc)
            elif desc_doc:
                desc_text = str(desc_doc)
                
            status_name = fields.get("status", {}).get("name", "Backlog")
            # Normalize Jira status names to match frontend columns (Backlog, In Progress, Done)
            if status_name.lower() in ["backlog", "to do", "to-do", "todo", "new"]:
                status_name = "Backlog"
            elif status_name.lower() in ["in progress", "inprogress", "doing", "active"]:
                status_name = "In Progress"
            elif status_name.lower() in ["done", "completed", "finished", "resolved"]:
                status_name = "Done"

            issues_list.append({
                "key": item.get("key", ""),
                "summary": fields.get("summary", ""),
                "description": desc_text,
                "status": status_name
            })
        return issues_list
    else:
        err_msg = f"Failed to retrieve Jira issues ({response.status_code}): {response.text}"
        logger.error(err_msg)
        raise Exception(err_msg)
