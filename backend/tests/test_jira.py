import os
import sys
import unittest
import asyncio

# Add parent path to import app services
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.services.jira import create_jira_issue, list_jira_issues, MOCK_DB_PATH
from app.core.config import settings

class TestJiraServices(unittest.TestCase):
    def setUp(self):
        """
        Clean up mock database before starting.
        Ensure settings are cleared to force local mock mode.
        """
        if os.path.exists(MOCK_DB_PATH):
            os.remove(MOCK_DB_PATH)
            
        self.original_url = settings.JIRA_URL
        self.original_email = settings.JIRA_EMAIL
        self.original_token = settings.JIRA_API_TOKEN
        
        # Clear settings to force offline fallback
        settings.JIRA_URL = ""
        settings.JIRA_EMAIL = ""
        settings.JIRA_API_TOKEN = ""

    def tearDown(self):
        """
        Restore configuration settings and clean up JSON database file.
        """
        settings.JIRA_URL = self.original_url
        settings.JIRA_EMAIL = self.original_email
        settings.JIRA_API_TOKEN = self.original_token
        
        if os.path.exists(MOCK_DB_PATH):
            os.remove(MOCK_DB_PATH)

    def test_offline_jira_workflow(self):
        """
        Verify offline issue creation, listing, and key increments.
        """
        # 1. Check initial listing initializes file with default templates
        issues = asyncio.run(list_jira_issues())
        self.assertGreaterEqual(len(issues), 2)
        self.assertEqual(issues[0]["key"], f"{settings.JIRA_PROJECT_KEY}-101")
        
        # 2. Add a new custom story
        new_title = "Update database indices"
        new_desc = "Add indexes on repo_id and filepath to speed up semantic queries."
        
        new_issue = asyncio.run(create_jira_issue(new_title, new_desc))
        self.assertEqual(new_issue["summary"], new_title)
        self.assertEqual(new_issue["key"], f"{settings.JIRA_PROJECT_KEY}-103") # Increment from 102
        
        # 3. Retrieve lists and verify prepended item matches
        updated_issues = asyncio.run(list_jira_issues())
        self.assertEqual(len(updated_issues), len(issues) + 1)
        self.assertEqual(updated_issues[0]["summary"], new_title)
        self.assertEqual(updated_issues[0]["description"], new_desc)

if __name__ == "__main__":
    unittest.main()
