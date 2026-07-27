import subprocess
import os
import logging
from typing import Dict, List, Tuple, Optional

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def run_git_command(repo_dir: Optional[str], args: List[str]) -> Tuple[int, str, str]:
    """
    Run a git command in the specified directory and capture outputs.
    """
    try:
        # On Windows, we need shell=True for shell commands if git is a bat/cmd file, 
        # but standard list inputs work well on standard OS.
        cwd = repo_dir if repo_dir else os.getcwd()
        result = subprocess.run(
            ["git"] + args,
            cwd=cwd,
            capture_output=True,
            text=True,
            check=False
        )
        return result.returncode, result.stdout, result.stderr
    except Exception as e:
        logger.error(f"Failed to execute git command {args}: {e}")
        return -1, "", str(e)

def clone_repo(repo_url: str, target_dir: str, token: Optional[str] = None) -> bool:
    """
    Clone a remote repository to a local directory.
    If a GITHUB_TOKEN is provided, it is injected into the HTTPS clone URL.
    """
    auth_url = repo_url
    if token and repo_url.startswith("https://github.com/"):
        # Format: https://<token>@github.com/owner/repo.git
        auth_url = repo_url.replace("https://github.com/", f"https://{token}@github.com/")
        
    logger.info(f"Cloning repository to target path: {target_dir}")
    
    # Make sure parent directory exists
    parent_dir = os.path.dirname(os.path.abspath(target_dir))
    os.makedirs(parent_dir, exist_ok=True)
    
    # Clone command
    code, stdout, stderr = run_git_command(None, ["clone", auth_url, target_dir])
    if code != 0:
        logger.error(f"Git clone failed: {stderr}")
        return False
        
    logger.info("Git clone completed successfully.")
    return True

def create_branch(repo_dir: str, branch_name: str) -> bool:
    """
    Create and checkout a new local git branch.
    """
    logger.info(f"Creating local branch: {branch_name} in {repo_dir}")
    # Run checkout -b
    code, stdout, stderr = run_git_command(repo_dir, ["checkout", "-b", branch_name])
    if code != 0:
        # If branch already exists, try checking it out
        code, stdout, stderr = run_git_command(repo_dir, ["checkout", branch_name])
        
    return code == 0

def apply_and_commit_changes(repo_dir: str, changes: Dict[str, str], commit_message: str) -> bool:
    """
    Write proposed file edits to disk, stage files via git add, and create a commit.
    """
    logger.info(f"Applying {len(changes)} code changes in {repo_dir}")
    
    try:
        # 1. Write changes to files
        for relative_path, file_content in changes.items():
            # Support relative paths with forward or backward slashes
            full_path = os.path.abspath(os.path.join(repo_dir, relative_path))
            
            # Make sure parent directories exist
            os.makedirs(os.path.dirname(full_path), exist_ok=True)
            
            # Write file content
            with open(full_path, "w", encoding="utf-8") as f:
                f.write(file_content)
                
            # Stage file
            code, stdout, stderr = run_git_command(repo_dir, ["add", relative_path])
            if code != 0:
                logger.error(f"Failed to git add file {relative_path}: {stderr}")
                return False
                
        # 2. Commit changes
        code, stdout, stderr = run_git_command(repo_dir, ["commit", "-m", commit_message])
        if code != 0:
            logger.error(f"Failed to git commit changes: {stderr}")
            return False
            
        logger.info("Staged and committed all code changes successfully.")
        return True
    except Exception as e:
        logger.error(f"Exception while applying and committing changes: {e}")
        return False

def push_branch(repo_dir: str, branch_name: str, token: Optional[str] = None) -> bool:
    """
    Push a branch to the remote origin.
    If a token is provided, uses it to authenticate the push.
    """
    logger.info(f"Pushing branch {branch_name} to origin...")
    
    # Get current origin URL
    code, stdout, stderr = run_git_command(repo_dir, ["remote", "get-url", "origin"])
    if code != 0:
        logger.error(f"Failed to get remote origin URL: {stderr}")
        return False
        
    remote_url = stdout.strip()
    
    # If using HTTPS and token is provided, push to the URL with injected token
    if token and remote_url.startswith("https://github.com/"):
        auth_url = remote_url.replace("https://github.com/", f"https://{token}@github.com/")
        # Push to authenticated URL directly
        code, stdout, stderr = run_git_command(repo_dir, ["push", auth_url, f"refs/heads/{branch_name}:refs/heads/{branch_name}"])
    else:
        # Standard push
        code, stdout, stderr = run_git_command(repo_dir, ["push", "-u", "origin", branch_name])
        
    if code != 0:
        logger.error(f"Git push failed: {stderr}")
        return False
        
    logger.info(f"Branch {branch_name} pushed to remote successfully.")
    return True
