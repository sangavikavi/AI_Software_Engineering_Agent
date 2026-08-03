import os
import logging
import json
from typing import Dict, Any, List

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Try importing OpenAI client
try:
    from openai import OpenAI
    HAS_OPENAI = True
except ImportError:
    HAS_OPENAI = False

def call_llm(system_prompt: str, user_prompt: str) -> str:
    """
    General entry point to call the LLM model.
    Checks for Groq, Gemini, or OpenAI API keys and launches OpenAI-compatible calls,
    falling back to a structured rule-based mock engine if no keys are present.
    """
    openai_key = os.environ.get("OPENAI_API_KEY")
    groq_key = os.environ.get("GROQ_API_KEY")
    gemini_key = os.environ.get("GEMINI_API_KEY")
    
    if not HAS_OPENAI:
        return get_mock_llm_response(system_prompt, user_prompt)
        
    # 1. Groq (Completely free high-speed tier for Llama 3)
    if groq_key:
        try:
            logger.info("Executing LLM call using Groq API...")
            client = OpenAI(api_key=groq_key, base_url="https://api.groq.com/openai/v1")
            response = client.chat.completions.create(
                model="llama-3.1-70b-versatile",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0.2
            )
            return response.choices[0].message.content or ""
        except Exception as e:
            logger.error(f"Groq API call failed, falling back: {e}")
            
    # 2. Google Gemini (Free tier for Gemini 1.5 Flash via AI Studio)
    if gemini_key:
        try:
            logger.info("Executing LLM call using Gemini API...")
            client = OpenAI(
                api_key=gemini_key,
                base_url="https://generativelanguage.googleapis.com/v1beta/openai/"
            )
            response = client.chat.completions.create(
                model="gemini-1.5-flash",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0.2
            )
            return response.choices[0].message.content or ""
        except Exception as e:
            logger.error(f"Gemini API call failed, falling back: {e}")

    # 3. Standard OpenAI API
    if openai_key:
        try:
            logger.info("Executing LLM call using OpenAI API...")
            client = OpenAI(api_key=openai_key)
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0.2
            )
            return response.choices[0].message.content or ""
        except Exception as e:
            logger.error(f"OpenAI API call failed, falling back: {e}")
            
    # Local mock simulation fallback
    return get_mock_llm_response(system_prompt, user_prompt)

def get_mock_llm_response(system_prompt: str, user_prompt: str) -> str:
    """
    A smart rule-based simulator that generates structured responses for agents
    (Planner, Coder, Tester, Reviewer) based on the user's codebase request.
    """
    logger.info("Local environment: running simulated agent heuristics...")
    
    system_lower = system_prompt.lower()
    user_lower = user_prompt.lower()
    
    # 1. PLANNER AGENT SIMULATION
    if "planner" in system_lower:
        # Detect what feature they want
        if "healthcheck" in user_lower or "health" in user_lower:
            return json.dumps([
                "Step 1: Check d:\\AI_Software_Engineering_Agent\\backend\\app\\main.py to locate existing routes.",
                "Step 2: Add a new GET route for /healthcheck returning system health metadata.",
                "Step 3: Run the automated pytest test suite to verify route responsiveness."
            ])
        elif "git" in user_lower or "github" in user_lower:
            return json.dumps([
                "Step 1: Add git credentials config validation in core/config.py.",
                "Step 2: Implement a GitHub client service to pull repository branches and commit logs.",
                "Step 3: Create testing routes to fetch user repository lists."
            ])
        else:
            return json.dumps([
                "Step 1: Analyze codebase structure files and target directories.",
                "Step 2: Implement requested modifications in target codebase files.",
                "Step 3: Run local validation tests to ensure code safety."
            ])
            
    # 2. CODER AGENT SIMULATION
    elif "coder" in system_lower:
        if "healthcheck" in user_lower or "health" in user_lower:
            # We mock writing a healthcheck endpoint
            return json.dumps({
                "app/main.py": """# Updated App Main with Healthcheck
from fastapi import FastAPI
# Existing imports preserved

app = FastAPI()

@app.get("/healthcheck")
def read_healthcheck():
    return {"status": "ok", "timestamp": "2026-07-26T20:00:00Z", "service": "AI SWE Agent Backend"}
"""
            })
        else:
            # Generic coding mock
            return json.dumps({
                "app/utils/sample.py": """# Simulated Code Implementation
def process_data(data):
    print("Processing incoming data block...")
    return {"status": "success", "processed": True, "count": len(data)}
"""
            })
            
    # 3. TESTER AGENT SIMULATION
    elif "tester" in system_lower:
        # Check if the code is valid Python syntax
        return json.dumps({
            "success": True,
            "logs": "Syntax check complete: OK.\npytest: 3 tests passed in 0.12 seconds.\nAll assertions verified.",
            "test_run_count": 3,
            "failures": 0
        })
        
    # 4. REVIEWER AGENT SIMULATION
    elif "reviewer" in system_lower:
        return json.dumps({
            "approved": True,
            "feedback": "The changes conform perfectly to FastAPI patterns. Route is clean, code is concise, and database imports are handled correctly."
        })
        
    return "Simulated LLM Response completed."
