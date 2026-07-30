# AI Software Engineering (SWE) Agent Platform - Interview & Project Guide

This guide describes what the project is, its core benefits, how it is implemented, and the step-by-step developer workflows.

---

## 1. Project Overview (In Simple Terms)
The **AI SWE Agent Platform** is an autonomous coding assistant (similar to Devin or OpenHands). It connects directly to **Jira Cloud** (for issue requirements) and **GitHub** (for code delivery). 

When given a requirement, it automatically analyzes the codebase, plans the tasks, implements the code edits, verifies they compile and pass tests in an isolated sandbox, and opens a Pull Request on GitHub for human review.

---

## 2. Core Benefits
- **Decomposes Tasks Automatically**: Breaks down complex user requests into step-by-step tasks, saving planning time.
- **Ensures Code Quality**: Never submits code that is broken. It validates syntax compiling and runs unit tests in a separate sandbox *before* committing.
- **Reduces Context Limits**: Uses semantic vector search (RAG) to search code files, meaning it only sends relevant files to the LLM instead of loading the entire codebase into context.
- **Human-in-the-Loop Safeguard**: Features a visual approval board where engineers review proposed code diffs before the PR is pushed.

---

## 3. End-to-End Developer Workflows

You can trigger the coding agent in two ways: **Jira-Triggered** or **Manual Input**.

### Workflow A: The Jira-Triggered Path (Standard)
This path pulls tasks directly from your Atlassian backlog and automatically syncs PR links.

1. **Requirement Source**: You view active tickets fetched from Jira Cloud on the **Jira Board** page.
2. **Trigger**: You click **Import & Execute** on a specific ticket (e.g., ticket `KAN-102` with summary *"Fix repo search API"*).
3. **Prompt Generation**: The system reads the ticket key and description, automatically pasting them into your active console prompt:
   `"Implement requirements for issue KAN-102: Fix repo search API..."`
4. **Planning & Writing**: The agent compiles the task list, semantic searches the code, and writes code updates.
5. **Sandbox Verification**: The agent tests edits in a temp sandbox workspace via `pytest` and `py_compile`.
6. **Approval Gate**: You review the proposed diff. Once you click **Approve & Open PR**:
   - The backend creates branch `swe-agent/patch-<unique-id>`.
   - The commit message generated includes the Jira ticket key:
     `git commit -m "feat: SWE patch - Implement requirements for issue KAN-102:..."`
   - The branch is pushed and the PR is raised.
7. **Jira Linkage**: Atlassian's GitHub integration detects the key `KAN-102` in the commit message and **automatically links the Pull Request to the Jira ticket** in your Jira Cloud dashboard.

---

### Workflow B: The Manual Input Path
This path allows you to type custom prompt instructions directly into the console.

1. **Requirement Source**: You type an instruction manually into the input bar in the **Workspace Console**.
   - *Example 1 (With Key)*: `"KAN-102: add a password reset route"`
   - *Example 2 (No Key)*: `"add a password reset route"`
2. **Execution**: The agent runs the standard Planner-Coder-Tester cycle.
3. **Approval Gate**: You review the proposed diff and click **Approve & Open PR**.
4. **Commit Creation**: The backend generates a commit message:
   `git commit -m "feat: SWE patch - <your manual text>"`
5. **Jira Linkage Rule**:
   - **If you included the key (Example 1)**: The commit message contains `KAN-102`. Jira Cloud will recognize this pattern and **successfully link** the PR to your Jira ticket.
   - **If you omitted the key (Example 2)**: The commit message does not contain any Jira reference. The Pull Request will still be created on GitHub, but it **will not link** to any Jira ticket.

---

## 4. How It Is Implemented (The 4 Pillars)

```
[ Jira Ticket / Manual Prompt ] ➔ [ RAG Semantic Search ] ➔ [ LangGraph Agent Loop ] ➔ [ Subprocess Sandbox ] ➔ [ Git & GitHub PR ]
```

1. **RAG Code Ingestion (SQLite + Numpy)**:
   - When a repository is connected, the backend parses all code files into smaller text chunks, calculates vector embeddings locally using a free SentenceTransformer model, and stores them in SQLite.
   - When a user asks for a feature, the system performs a semantic search to fetch only the files related to the request.
2. **LangGraph Agent Brain**:
   - Instead of a single long prompt, the system divides the AI brain into four specialists:
     - **Planner**: Creates the checklist.
     - **Coder**: Receives code files and proposes edits.
     - **Tester**: Validates changes in the sandbox.
     - **Reviewer**: Evaluates code quality and handles loops (sends files back to Coder if tests fail).
3. **Subprocess Isolation Sandbox**:
   - The backend copies the code to a temporary path under `backend/temp_sandboxes/`.
   - It applies the edits, checks compiling (`py_compile`), runs `pytest`, captures stderr outputs, and deletes the temporary path.
4. **Git Operations & GitHub REST API**:
   - If approved by the user, the backend runs local Git commands via a subprocess to checkout a patch branch, commit, and push.
   - It calls the GitHub REST API (`/pulls` endpoint) to open a Pull Request.

---

## 5. Potential Interview Cross-Questions & How to Answer Them

### Q1: How does the agent understand a large codebase of thousands of files without exceeding the LLM context window?
- **Answer**: *"We implement a **Codebase RAG (Retrieval-Augmented Generation) pipeline**. When the repository is connected, we parse the source code files, chunk them by line ranges, and calculate 384-dimensional vector embeddings using a local Hugging Face SentenceTransformer model. We store these vectors in SQLite. When a task is started, we calculate the query vector, search our database, and retrieve only the top 5–10 most relevant code chunks to inject into the LLM prompt. This keeps context sizes tiny and speeds up processing."*

### Q2: Why use a multi-agent graph (LangGraph) instead of just one single LLM prompt?
- **Answer**: *"A single prompt often struggles with complex tasks, suffering from 'forgetting' or hallucinating. By using **LangGraph**, we implement **separation of concerns**. Each agent acts as a specialized node with a specific prompt. For example, the Coder only focuses on writing edits, and the Reviewer only focuses on auditing quality. Most importantly, LangGraph allows **loops**. If the Tester finds a bug, we can route the state back to the Coder node, passing the compiler error output so it can correct itself. You cannot do this cycle reliably in a single prompt call."*

### Q3: How do you protect the system from the agent running infinite loops or executing dangerous code in the sandbox?
- **Answer**: 
  - **Loop Protection**: *"We set a strict limit on the state machine iterations (maximum of 4 loops). If the agent cannot pass tests after 4 tries, it stops and requests human assistance."*
  - **Sandbox Security**: *"In our local setup, we run tests inside isolated subprocess paths under `backend/temp_sandboxes/` and run them as a separate user space. In a production environment, we deploy this by running the sandbox inside a temporary Docker container using the Docker SDK, which fully isolates CPU/disk access."*

### Q4: How does your database check for file updates? Does it re-index everything on every commit?
- **Answer**: *"No, that would be very slow. We calculate the MD5 hash of each code file during ingestion. When we re-index, we compare the current MD5 hash of the file with the hash stored in SQLite. If they match, we skip parsing and keep the existing embeddings. We only compute new embeddings for new or modified files."*

### Q5: What happens if there's no internet or LLM API keys are missing?
- **Answer**: *"The platform is built with a smart **rule-based simulation engine** inside the LLM service. If no OpenAI or Groq keys are configured in the `.env` file, the backend falls back to this simulator. It generates mock plans, proposed code changes, sandbox compile outputs, and Git branches, allowing developers to demo and test the entire layout immediately for free."*