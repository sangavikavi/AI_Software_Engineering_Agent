import os
import sys
import shutil
import stat
import unittest

# Add parent path to import app services
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.services.sandbox import verify_proposed_changes

def remove_readonly(func, path, excinfo):
    """
    Error handler for removing read-only files on Windows.
    """
    try:
        os.chmod(path, stat.S_IWRITE)
        func(path)
    except Exception as e:
        print(f"Failed to delete {path}: {e}")

class TestSandboxServices(unittest.TestCase):
    def setUp(self):
        """
        Set up a temporary mock codebase repository to serve as source files.
        """
        self.source_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "temp_source_repo"))
        
        # Clean up any leftover folders
        if os.path.exists(self.source_dir):
            shutil.rmtree(self.source_dir, onerror=remove_readonly)
            
        os.makedirs(self.source_dir, exist_ok=True)
        
        # Create standard files
        self.code_path = "app/calculator.py"
        self.test_path = "tests/test_calculator.py"
        
        os.makedirs(os.path.join(self.source_dir, "app"), exist_ok=True)
        os.makedirs(os.path.join(self.source_dir, "tests"), exist_ok=True)
        
        # Write valid calculator code
        with open(os.path.join(self.source_dir, self.code_path), "w") as f:
            f.write("def add_numbers(x, y):\n    return x + y\n")
            
        # Write passing test file
        with open(os.path.join(self.source_dir, self.test_path), "w") as f:
            f.write("from app.calculator import add_numbers\n\ndef test_add():\n    assert add_numbers(2, 3) == 5\n")

    def tearDown(self):
        """
        Delete source repository directories.
        """
        if os.path.exists(self.source_dir):
            shutil.rmtree(self.source_dir, onerror=remove_readonly)

    def test_sandbox_passing_changes(self):
        """
        Verify that a valid modification checks syntax and passes tests.
        """
        changes = {
            self.code_path: "def add_numbers(x, y):\n    print('Adding numbers...')\n    return x + y\n"
        }
        res = verify_proposed_changes(self.source_dir, changes)
        
        self.assertTrue(res["success"], f"Execution should pass. Logs:\n{res['logs']}")
        self.assertEqual(res["failures"], 0)

    def test_sandbox_syntax_error(self):
        """
        Verify that syntax errors (like missing colons) are caught during py_compile.
        """
        # Missing colon in function definition
        changes = {
            self.code_path: "def add_numbers(x, y)\n    return x + y\n"
        }
        res = verify_proposed_changes(self.source_dir, changes)
        
        self.assertFalse(res["success"])
        self.assertIn("Syntax error", res["logs"])
        self.assertGreater(res["failures"], 0)

    def test_sandbox_test_failure(self):
        """
        Verify that failing pytest assertions are caught and returned as failures.
        """
        # Set test assertion to failing value (e.g. 2 + 3 == 9)
        changes = {
            self.test_path: "from app.calculator import add_numbers\n\ndef test_add():\n    assert add_numbers(2, 3) == 9\n"
        }
        res = verify_proposed_changes(self.source_dir, changes)
        
        self.assertFalse(res["success"])
        self.assertIn("Test Execution Failed", res["logs"])
        self.assertGreater(res["failures"], 0)

if __name__ == "__main__":
    unittest.main()
