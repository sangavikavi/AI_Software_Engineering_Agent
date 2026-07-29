import os
import shutil
import uuid
import subprocess
import stat
import logging
from typing import Dict, Any, Tuple, List

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Ignored directory names for copy trees
IGNORE_DIR_NAMES = {'.git', '.venv', 'venv', 'env', 'node_modules', '__pycache__', '.pytest_cache'}

def remove_readonly(func, path, excinfo):
    """
    Error handler for removing read-only files on Windows.
    """
    try:
        os.chmod(path, stat.S_IWRITE)
        func(path)
    except Exception as e:
        logger.error(f"Failed to delete sandboxed path {path}: {e}")

def ignore_large_folders(path, names):
    """
    Callback for shutil.copytree to exclude dependency and git folders from sandbox.
    """
    ignored = []
    for name in names:
        if name in IGNORE_DIR_NAMES:
            ignored.append(name)
    return ignored

def run_command(cwd: str, command: List[str]) -> Tuple[int, str, str]:
    """
    Execute subprocess command within the sandbox cwd.
    """
    try:
        # Use python from active venv if running locally on Windows
        # If in active venv, python path can be fetched from sys.executable
        import sys
        
        # Adjust python path if command contains "python"
        adjusted_command = list(command)
        if adjusted_command[0] == "python":
            adjusted_command[0] = sys.executable
            
        result = subprocess.run(
            adjusted_command,
            cwd=cwd,
            capture_output=True,
            text=True,
            check=False
        )
        return result.returncode, result.stdout, result.stderr
    except Exception as e:
        logger.error(f"Sandbox command execution failed {command}: {e}")
        return -1, "", str(e)

def verify_proposed_changes(source_dir: str, changes: Dict[str, str]) -> Dict[str, Any]:
    """
    Main orchestrator for verifying code changes.
    1. Generates temporary workspace.
    2. Writes proposed files.
    3. Performs syntax checks.
    4. Runs tests (pytest).
    5. Cleans up sandbox folder.
    """
    logger.info(f"Setting up sandbox to verify {len(changes)} files from: {source_dir}")
    
    # Define a sandboxed directory inside the backend workspace to adhere to security paths
    sandbox_id = str(uuid.uuid4())
    backend_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    sandbox_dir = os.path.join(backend_root, "temp_sandboxes", sandbox_id)
    
    try:
        # 1. Create sandbox directory tree
        os.makedirs(sandbox_dir, exist_ok=True)
        shutil.copytree(source_dir, sandbox_dir, ignore=ignore_large_folders, dirs_exist_ok=True)
        
        # 2. Write proposed changes
        for rel_path, file_content in changes.items():
            full_path = os.path.abspath(os.path.join(sandbox_dir, rel_path))
            os.makedirs(os.path.dirname(full_path), exist_ok=True)
            with open(full_path, "w", encoding="utf-8") as f:
                f.write(file_content)
                
        # 3. Check syntax for Python files
        syntax_errors = []
        for rel_path in changes.keys():
            if rel_path.endswith(".py"):
                full_path = os.path.abspath(os.path.join(sandbox_dir, rel_path))
                code, stdout, stderr = run_command(sandbox_dir, ["python", "-m", "py_compile", full_path])
                if code != 0:
                    syntax_errors.append(f"Syntax error in {rel_path}:\n{stderr or stdout}")
                    
        if syntax_errors:
            error_logs = "\n".join(syntax_errors)
            logger.warning(f"Syntax validation failed in sandbox:\n{error_logs}")
            return {
                "success": False,
                "logs": f"Syntax Check Failed:\n{error_logs}",
                "test_run_count": 0,
                "failures": len(syntax_errors)
            }
            
        # 4. Check if pytest exists and run tests
        # We search if there are any test files or test configuration
        # For simplicity, we just try running pytest inside the sandbox CWD
        logger.info("Running pytest inside the sandbox...")
        code, stdout, stderr = run_command(sandbox_dir, ["python", "-m", "pytest"])
        
        # Parse pytest output
        logs = stdout + "\n" + stderr
        
        # Pytest return codes:
        # 0: All tests passed
        # 1: Tests were run and some failed
        # 5: No tests collected (not an error for projects without tests)
        if code == 0:
            return {
                "success": True,
                "logs": f"Syntax OK. All tests passed.\n\n{stdout}",
                "test_run_count": 1, # Minimal representation
                "failures": 0
            }
        elif code == 1:
            return {
                "success": False,
                "logs": f"Test Execution Failed:\n\n{logs}",
                "test_run_count": 1,
                "failures": 1
            }
        elif code == 5:
            # No tests found; treat as syntax check success
            return {
                "success": True,
                "logs": f"Syntax OK. (No automated unit tests found in codebase).\n\n{stdout}",
                "test_run_count": 0,
                "failures": 0
            }
        else:
            # General compilation failure
            return {
                "success": False,
                "logs": f"Runner Error: test suite run crashed with code {code}.\n{logs}",
                "test_run_count": 0,
                "failures": 1
            }
            
    except Exception as e:
        logger.error(f"Error during sandbox execution orchestrator: {e}")
        return {
            "success": False,
            "logs": f"Sandbox Exception: {str(e)}",
            "test_run_count": 0,
            "failures": 1
        }
    finally:
        # 5. Clean up sandbox folder
        if os.path.exists(sandbox_dir):
            shutil.rmtree(sandbox_dir, onerror=remove_readonly)
            logger.info(f"Sandbox {sandbox_id} cleaned up.")
