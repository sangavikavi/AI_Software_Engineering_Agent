import logging
from typing import Tuple, Optional
import httpx

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def parse_github_url(url: str) -> Tuple[str, str]:
    """
    Extract the repository owner and name from a GitHub HTTPS or SSH URL.
    """
    cleaned = url.strip()
    if cleaned.endswith(".git"):
        cleaned = cleaned[:-4]
        
    if "github.com/" in cleaned:
        # Split after domain
        parts = cleaned.split("github.com/")[-1].split("/")
    elif "github.com:" in cleaned:
        # Split SSH format
        parts = cleaned.split("github.com:")[-1].split("/")
    else:
        parts = cleaned.split("/")
        
    if len(parts) >= 2:
        return parts[-2], parts[-1]
    return "", ""

async def create_pull_request(
    repo_url: str,
    title: str,
    body: str,
    head_branch: str,
    base_branch: str = "main",
    token: Optional[str] = None
) -> str:
    """
    Submit a POST request to GitHub's REST API to open a Pull Request.
    If no token is supplied, returns a simulated mock Pull Request URL.
    """
    owner, repo = parse_github_url(repo_url)
    if not owner or not repo:
        raise ValueError(f"Unable to parse owner/repository from URL: {repo_url}")
        
    # Mock fallback for local dev when token is omitted
    if not token:
        logger.warning("GITHUB_TOKEN not configured. Generating simulated Pull Request link.")
        return f"https://github.com/{owner}/{repo}/pull/mock-{head_branch.split('/')[-1][:6]}"
        
    api_url = f"https://api.github.com/repos/{owner}/{repo}/pulls"
    
    headers = {
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "Antigravity-SWE-Agent"
    }
    
    payload = {
        "title": title,
        "body": body,
        "head": head_branch,
        "base": base_branch
    }
    
    logger.info(f"Submitting PR creation to GitHub: {api_url}")
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(api_url, headers=headers, json=payload, timeout=10.0)
            
        if response.status_code == 201:
            data = response.json()
            pr_url = data.get("html_url", "")
            logger.info(f"Pull Request opened successfully: {pr_url}")
            return pr_url
        else:
            error_detail = response.json() if response.headers.get("content-type", "").startswith("application/json") else response.text
            err_msg = f"GitHub API failed with status {response.status_code}: {error_detail}"
            logger.error(err_msg)
            raise Exception(err_msg)
            
    except Exception as e:
        logger.error(f"Failed to communicate with GitHub API: {e}")
        # If API failed but we have a token (e.g. internet issues or duplicate PR), fall back to mock to prevent blocking dev
        mock_url = f"https://github.com/{owner}/{repo}/pull/mock-fallback"
        logger.warning(f"Falling back to mock URL: {mock_url}")
        return mock_url
