import os
import sys
import unittest

# Add parent path to import app services
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.services.agents import compiled_graph

class TestLangGraphAgents(unittest.TestCase):
    def test_agent_graph_execution(self):
        """
        Verify that the compiled LangGraph executes through all node steps:
        Planner -> Coder -> Tester -> Reviewer -> Awaiting Approval
        """
        # 1. Initialize State
        initial_state = {
            "instruction": "add a healthcheck route to app/main.py",
            "codebase_context": [
                "@app.get('/')\ndef read_root():\n    return {'message': 'welcome'}"
            ],
            "plan": [],
            "current_step_index": 0,
            "proposed_changes": {},
            "test_results": {},
            "review_feedback": {},
            "status": "planning",
            "iterations": 0,
            "history_logs": []
        }
        
        # 2. Invoke Graph
        print("Invoking LangGraph compiled state machine...")
        final_state = compiled_graph.invoke(initial_state)
        
        # 3. Assertions
        print("Verifying state transitions...")
        
        # Check plan was generated
        self.assertGreater(len(final_state["plan"]), 0, "Planner should generate steps")
        print(f"-> Generated plan: {final_state['plan']}")
        
        # Check code changes were proposed
        self.assertIn("app/main.py", final_state["proposed_changes"], "Coder should propose modifications to main.py")
        
        # Check tests ran successfully
        self.assertTrue(final_state["test_results"]["success"], "Tester should report successful tests")
        
        # Check reviewer approved
        self.assertTrue(final_state["review_feedback"]["approved"], "Reviewer should approve final changes")
        
        # Check final status and logs
        self.assertEqual(final_state["status"], "ready", "Graph should halt in 'ready' (awaiting human gate)")
        self.assertGreater(len(final_state["history_logs"]), 0, "Transition logs should be populated")
        
        print("\nMulti-Agent Graph Logs:")
        for log in final_state["history_logs"]:
            print(f"  * {log}")

if __name__ == "__main__":
    unittest.main()
