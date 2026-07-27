import os
import sys
import shutil
import stat
import unittest

# Add parent path to import app services
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.services.git import run_git_command, create_branch, apply_and_commit_changes
from app.services.github import parse_github_url

def remove_readonly(func, path, excinfo):
    """
    Error handler for shutil.rmtree on Windows.
    Toggles read-only file attributes to writeable and retries the deletion.
    """
    try:
        os.chmod(path, stat.S_IWRITE)
        func(path)
    except Exception as e:
        print(f"Failed to delete {path}: {e}")

class TestGitServices(unittest.TestCase):
    def setUp(self):
        """
        Create a sandboxed temporary directory and initialize it as a git repo.
        First cleans up any dirty leftover directories from previous aborted tests.
        """
        self.test_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "temp_mock_repo"))
        
        # Clean up any leftover directory from dirty state
        if os.path.exists(self.test_dir):
            shutil.rmtree(self.test_dir, onerror=remove_readonly)
            
        os.makedirs(self.test_dir, exist_ok=True)
        
        # Init repository
        code, stdout, stderr = run_git_command(self.test_dir, ["init"])
        self.assertEqual(code, 0, "Git init must succeed.")
        
        # Configure local dummy author for commit tests
        run_git_command(self.test_dir, ["config", "user.name", "AgentTester"])
        run_git_command(self.test_dir, ["config", "user.email", "tester@agent.com"])
        
        # Create an initial commit to establish HEAD branch
        with open(os.path.join(self.test_dir, "initial.txt"), "w") as f:
            f.write("initial file content")
            
        run_git_command(self.test_dir, ["add", "initial.txt"])
        run_git_command(self.test_dir, ["commit", "-m", "initial commit"])

    def tearDown(self):
        """
        Deletes the temporary mock repository directory after testing is complete.
        """
        if os.path.exists(self.test_dir):
            shutil.rmtree(self.test_dir, onerror=remove_readonly)

    def test_git_branching_and_committing(self):
        """
        Assert checkout of new branch, file edits, and git add/commits complete correctly.
        """
        branch_name = "swe-agent/patch-test"
        
        # Test branch creation
        self.assertTrue(create_branch(self.test_dir, branch_name))
        
        # Test file additions
        changes = {
            "app/utils/sample.py": "def test():\n    return 'pass'",
            "README.md": "# Readme Title"
        }
        
        self.assertTrue(apply_and_commit_changes(self.test_dir, changes, "feat: test apply changes"))
        
        # Verify files on disk
        sample_file_path = os.path.join(self.test_dir, "app/utils/sample.py")
        self.assertTrue(os.path.exists(sample_file_path))
        with open(sample_file_path, "r") as f:
            self.assertEqual(f.read(), "def test():\n    return 'pass'")
            
        # Verify git commit log
        code, stdout, stderr = run_git_command(self.test_dir, ["log", "-n", "1"])
        self.assertEqual(code, 0)
        self.assertIn("feat: test apply changes", stdout)

    def test_github_url_parsing(self):
        """
        Verify the URL parser accurately extracts Owner and Repository details.
        """
        test_cases = [
            ("https://github.com/sangavikavi/AI_Software_Engineering_Agent.git", ("sangavikavi", "AI_Software_Engineering_Agent")),
            ("https://github.com/octocat/Hello-World", ("octocat", "Hello-World")),
            ("git@github.com:user-name/repo-name.git", ("user-name", "repo-name"))
        ]
        
        for url, expected in test_cases:
            owner, repo = parse_github_url(url)
            self.assertEqual((owner, repo), expected)

if __name__ == "__main__":
    unittest.main()
