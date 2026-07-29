import React, { useState, useEffect } from 'react';
import './App.css';

interface SystemStatus {
  agent_active: boolean;
  database_connected: boolean;
  repositories_connected: number;
  running_jobs: number;
  api_online: boolean;
}

interface Repository {
  id: number;
  name: string;
  clone_url: string;
  local_path: string;
  status: string;
}

interface AgentRunResponse {
  run_id: string;
  repository_id: number;
  instruction: string;
  status: string;
  plan: string[];
  current_step_index: number;
  proposed_changes: Record<string, string>;
  test_results: { success?: boolean; logs?: string; test_run_count?: number; failures?: number };
  review_feedback: { approved?: boolean; feedback?: string };
  history_logs: string[];
  iterations: number;
}

interface JiraIssue {
  key: string;
  summary: string;
  description: string;
  status: string;
  url?: string;
}

function App() {
  const [status, setStatus] = useState<SystemStatus>({
    agent_active: false,
    database_connected: false,
    repositories_connected: 0,
    running_jobs: 0,
    api_online: false
  });
  
  // Workspace and Repo states
  const [repoUrl, setRepoUrl] = useState('');
  const [repoName, setRepoName] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState<number | null>(null);
  
  // Agent run states
  const [instruction, setInstruction] = useState('');
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [runDetails, setRunDetails] = useState<AgentRunResponse | null>(null);
  const [isSubmittingRun, setIsSubmittingRun] = useState(false);
  
  // Jira Integration states
  const [jiraIssues, setJiraIssues] = useState<JiraIssue[]>([]);
  const [newJiraSummary, setNewJiraSummary] = useState('');
  const [newJiraDesc, setNewJiraDesc] = useState('');
  const [isCreatingJira, setIsCreatingJira] = useState(false);

  // Log stream
  const [logs, setLogs] = useState<string[]>([
    "System: Console online. Awaiting repository connections..."
  ]);

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

  // 1. Poll Backend Health, Repositories, and Jira Issues list
  const fetchInitialData = async () => {
    try {
      const healthRes = await fetch(`${API_URL}/health`);
      const statusRes = await fetch(`${API_URL}/api/v1/status`);
      const reposRes = await fetch(`${API_URL}/api/v1/repositories`);
      const jiraRes = await fetch(`${API_URL}/api/v1/jira/issues`);
      
      if (healthRes.ok && statusRes.ok) {
        const statusData = await statusRes.json();
        setStatus({
          agent_active: statusData.agent_active,
          database_connected: statusData.database_connected,
          repositories_connected: statusData.repositories_connected,
          running_jobs: statusData.running_jobs,
          api_online: true
        });
      } else {
        setStatus(prev => ({ ...prev, api_online: false }));
      }

      if (reposRes.ok) {
        const reposData = await reposRes.json();
        setRepositories(reposData);
        if (reposData.length > 0 && selectedRepoId === null) {
          setSelectedRepoId(reposData[0].id);
        }
      }

      if (jiraRes.ok) {
        const jiraData = await jiraRes.json();
        setJiraIssues(jiraData);
      }
    } catch (err) {
      setStatus(prev => ({ ...prev, api_online: false }));
    }
  };

  useEffect(() => {
    fetchInitialData();
    const interval = setInterval(fetchInitialData, 5000);
    return () => clearInterval(interval);
  }, [selectedRepoId]);

  // 2. Poll Active Agent Run Status
  useEffect(() => {
    if (!activeRunId) return;

    const pollRunStatus = async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/agents/runs/${activeRunId}`);
        if (res.ok) {
          const data: AgentRunResponse = await res.json();
          setRunDetails(data);
          setLogs(data.history_logs);
          
          // Stop polling if complete or failed
          if (data.status === 'finished' || data.status === 'failed') {
            setActiveRunId(null);
            fetchInitialData(); // Refresh backlog status if merged
          }
        }
      } catch (err) {
        console.error('Error polling agent run status:', err);
      }
    };

    pollRunStatus();
    const interval = setInterval(pollRunStatus, 1000); // Fast updates
    return () => clearInterval(interval);
  }, [activeRunId]);

  // 3. Connect GitHub Repo URL
  const handleConnectRepo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrl.trim() || !repoName.trim()) return;

    setIsConnecting(true);
    setLogs(prev => [...prev, `System: Registering repository ${repoName}...`]);

    try {
      const res = await fetch(`${API_URL}/api/v1/repositories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: repoName,
          clone_url: repoUrl,
          local_path: `./clones/${repoName}`
        })
      });

      if (res.ok) {
        const newRepo = await res.json();
        setRepositories(prev => [...prev, newRepo]);
        setSelectedRepoId(newRepo.id);
        setRepoUrl('');
        setRepoName('');
        setLogs(prev => [...prev, `System: Repository '${newRepo.name}' connected successfully. Triggering index...`]);
        
        // Auto-index
        await fetch(`${API_URL}/api/v1/repositories/${newRepo.id}/index`, { method: 'POST' });
        setLogs(prev => [...prev, `System: Indexing codebase chunks in background...`]);
      } else {
        setLogs(prev => [...prev, `System Error: Failed to register repository.`]);
      }
    } catch (err) {
      setLogs(prev => [...prev, `System Error: Connection error.`]);
    } finally {
      setIsConnecting(false);
      fetchInitialData();
    }
  };

  // 4. Trigger LangGraph Agent execution
  const handleRunAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!instruction.trim() || selectedRepoId === null) return;

    setIsSubmittingRun(true);
    setRunDetails(null);
    setLogs(prev => [...prev, `System: Starting agent execution for request: '${instruction}'`]);

    try {
      const res = await fetch(`${API_URL}/api/v1/agents/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repository_id: selectedRepoId,
          instruction: instruction
        })
      });

      if (res.ok) {
        const data = await res.json();
        setActiveRunId(data.run_id);
        setInstruction('');
      } else {
        const errData = await res.json();
        setLogs(prev => [...prev, `System Error: ${errData.detail || 'Failed to start agent.'}`]);
      }
    } catch (err) {
      setLogs(prev => [...prev, `System Error: Connection failed.`]);
    } finally {
      setIsSubmittingRun(false);
    }
  };

  // 5. Human Approval trigger
  const handleApproveChanges = async () => {
    if (!runDetails) return;
    setLogs(prev => [...prev, "System: Approving proposed changes..."]);
    
    try {
      const res = await fetch(`${API_URL}/api/v1/agents/runs/${runDetails.run_id}/approve`, {
        method: 'POST'
      });
      if (res.ok) {
        const data = await res.json();
        setRunDetails(prev => prev ? { ...prev, status: 'finished' } : null);
        setLogs(prev => [
          ...prev, 
          "System: Human approved. Successfully applied changes locally.",
          `System: Branch pushed & Pull Request created! Link: ${data.pr_url}`
        ]);
        fetchInitialData();
      }
    } catch (err) {
      setLogs(prev => [...prev, "System Error: Failed to send approval."]);
    }
  };

  // 6. Create Jira Issue
  const handleCreateJiraIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newJiraSummary.trim()) return;

    setIsCreatingJira(true);
    setLogs(prev => [...prev, `System: Posting story '${newJiraSummary}' to Jira Backlog...`]);

    try {
      const res = await fetch(`${API_URL}/api/v1/jira/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: newJiraSummary,
          description: newJiraDesc
        })
      });

      if (res.ok) {
        const newIssue = await res.json();
        setNewJiraSummary('');
        setNewJiraDesc('');
        setLogs(prev => [...prev, `System: Jira Issue ${newIssue.key} created successfully.`]);
        
        // Refresh Jira issues list
        const refreshRes = await fetch(`${API_URL}/api/v1/jira/issues`);
        if (refreshRes.ok) {
          setJiraIssues(await refreshRes.json());
        }
      } else {
        setLogs(prev => [...prev, "System Error: Failed to create Jira ticket."]);
      }
    } catch (err) {
      setLogs(prev => [...prev, "System Error: Jira connection failed."]);
    } finally {
      setIsCreatingJira(false);
    }
  };

  // 7. Load Jira Story into active prompt
  const handleImportJiraStory = (issue: JiraIssue) => {
    setInstruction(`Implement requirements for issue ${issue.key}:\n${issue.description}`);
    setLogs(prev => [...prev, `System: Imported requirements from ${issue.key} into prompt.`]);
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-[#f4f4f5] font-sans animate-fade-in">
      <div className="max-w-[1300px] mx-auto px-4 py-6 w-full">
        {/* Header */}
        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-white/8 pb-5 mb-6 gap-4">
          <div>
            <h1 className="text-2xl font-semibold font-heading flex items-center gap-2.5 text-[#f4f4f5]">
              <svg className="text-cyan-400 animate-pulse" width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 17L12 22L22 17" stroke="var(--color-purple)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              AI Software Engineer Platform
            </h1>
            <p className="text-zinc-400 text-sm mt-1">
              Autonomous Multi-Agent Engineering Engine & Jira Backlog Console
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            {status.api_online ? (
              <span className="inline-flex items-center text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full gap-1.5 bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 before:w-1.5 before:h-1.5 before:rounded-full before:bg-emerald-400">
                API Online
              </span>
            ) : (
              <span className="inline-flex items-center text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full gap-1.5 bg-rose-500/15 text-rose-400 border border-rose-500/30 before:w-1.5 before:h-1.5 before:rounded-full before:bg-rose-400">
                API Offline
              </span>
            )}
            {status.database_connected ? (
              <span className="inline-flex items-center text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full gap-1.5 bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 before:w-1.5 before:h-1.5 before:rounded-full before:bg-emerald-400">
                DB Connected
              </span>
            ) : (
              <span className="inline-flex items-center text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full gap-1.5 bg-amber-500/15 text-amber-400 border border-amber-500/30 before:w-1.5 before:h-1.5 before:rounded-full before:bg-amber-400">
                DB Idle
              </span>
            )}
          </div>
        </header>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column (Console & Instructions) */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            
            {/* Repository Connection */}
            <section className="bg-[#121214] border border-white/8 rounded-xl p-6 transition-all duration-200 hover:border-white/16 hover:shadow-2xl hover:shadow-black/40 border-l-4 border-l-cyan-500">
              <h2 className="text-lg font-semibold mb-2 flex items-center gap-2 text-[#f4f4f5]">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
                </svg>
                Connect GitHub Repository
              </h2>
              <p className="text-zinc-400 text-sm mb-4">
                Clone a git repository to analyze codebase structure, generate schemas, and prepare autonomous pull requests.
              </p>
              
              <form onSubmit={handleConnectRepo} className="flex flex-col md:flex-row gap-3">
                <input
                  type="text"
                  value={repoName}
                  onChange={(e) => setRepoName(e.target.value)}
                  placeholder="Repo Name (e.g. backend)"
                  disabled={isConnecting}
                  className="bg-[#09090b] border border-white/8 rounded-lg px-3 py-2 text-[#f4f4f5] text-sm outline-none focus:border-cyan-500/50 md:w-1/4 disabled:opacity-50"
                  required
                />
                <input
                  type="text"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="GitHub Clone URL (https://github.com/...)"
                  disabled={isConnecting}
                  className="flex-1 bg-[#09090b] border border-white/8 rounded-lg px-4 py-2.5 text-[#f4f4f5] text-sm outline-none focus:border-cyan-500/50 transition-colors disabled:opacity-50"
                  required
                />
                <button
                  type="submit"
                  disabled={isConnecting || !repoUrl || !repoName}
                  className="inline-flex items-center justify-center font-medium text-sm px-5 py-2.5 rounded-lg bg-gradient-to-r from-cyan-500 to-violet-500 text-white shadow-[0_4px_14px_rgba(6,182,212,0.2)] hover:opacity-95 hover:-translate-y-0.5 hover:shadow-[0_6px_20px_rgba(6,182,212,0.35)] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isConnecting ? 'Connecting...' : 'Connect'}
                </button>
              </form>

              {repositories.length > 0 && (
                <div className="mt-4 border-t border-white/8 pt-4">
                  <h3 className="text-sm text-zinc-400 mb-2">Connected Repositories:</h3>
                  <div className="flex flex-wrap gap-2">
                    {repositories.map((repo) => (
                      <button
                        key={repo.id}
                        onClick={() => setSelectedRepoId(repo.id)}
                        className={`px-4 py-2 rounded-lg text-sm font-mono border transition-all cursor-pointer ${
                          selectedRepoId === repo.id
                            ? 'bg-cyan-500/15 border-cyan-500 text-cyan-400 font-semibold'
                            : 'bg-white/2 border-white/8 text-zinc-300 hover:border-white/16'
                        }`}
                      >
                        {repo.name} ({repo.status})
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {/* Execute Agent Instruction */}
            <section className="bg-[#121214] border border-white/8 rounded-xl p-6 transition-all duration-200 hover:border-white/16 hover:shadow-2xl hover:shadow-black/40">
              <h2 className="text-lg font-semibold mb-2 flex items-center gap-2 text-[#f4f4f5]">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                Autonomous Agent Execution Node
              </h2>
              <p className="text-zinc-400 text-sm mb-4">
                Submit coding instructions. The LangGraph multi-agent flow will analyze the request, write file changes, and verify them in a sandbox.
              </p>
              
              <form onSubmit={handleRunAgent} className="flex gap-3">
                <input
                  type="text"
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="E.g. add a healthcheck endpoint to app/main.py"
                  disabled={isSubmittingRun || activeRunId !== null || selectedRepoId === null}
                  className="flex-1 bg-[#09090b] border border-white/8 rounded-lg px-4 py-2.5 text-[#f4f4f5] text-sm outline-none focus:border-cyan-500/50 transition-colors disabled:opacity-50"
                  required
                />
                <button
                  type="submit"
                  disabled={isSubmittingRun || activeRunId !== null || !instruction || selectedRepoId === null}
                  className="inline-flex items-center justify-center font-medium text-sm px-5 py-2.5 rounded-lg bg-gradient-to-r from-violet-500 to-cyan-500 text-white shadow-[0_4px_14px_rgba(139,92,246,0.2)] hover:opacity-95 hover:-translate-y-0.5 hover:shadow-[0_6px_20px_rgba(139,92,246,0.35)] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmittingRun || activeRunId !== null ? 'Agent Running...' : 'Execute Agent'}
                </button>
              </form>
            </section>

            {/* Agent Activity Terminal */}
            <section className="bg-[#121214] border border-white/8 rounded-xl p-6 transition-all duration-200 hover:border-white/16 hover:shadow-2xl hover:shadow-black/40 flex flex-col flex-1 min-h-[350px]">
              <div className="flex justify-between items-center mb-3.5">
                <h2 className="text-lg font-semibold flex items-center gap-2 text-[#f4f4f5]">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="4 17 10 11 4 5" />
                    <line x1="12" y1="19" x2="20" y2="19" />
                  </svg>
                  LangGraph Live Transition Logs
                </h2>
                <div className="text-xs text-zinc-500 font-mono">
                  {runDetails ? `Run status: ${runDetails.status.toUpperCase()}` : 'Awaiting prompt...'}
                </div>
              </div>
              
              <div className="flex-1 bg-[#09090b] border border-white/8 rounded-lg p-4 font-mono text-[13px] leading-relaxed overflow-y-auto max-h-[300px]">
                {logs.map((log, idx) => {
                  let logColor = "text-[#f4f4f5]";
                  if (log.toLowerCase().includes("error")) logColor = "text-rose-400";
                  else if (log.toLowerCase().includes("system:")) logColor = "text-cyan-400";
                  else if (log.toLowerCase().includes("planner:")) logColor = "text-violet-400";
                  else if (log.toLowerCase().includes("coder:")) logColor = "text-amber-400";
                  else if (log.toLowerCase().includes("tester:")) logColor = "text-emerald-400";
                  else if (log.toLowerCase().includes("reviewer:")) logColor = "text-orange-400 font-semibold";

                  return (
                    <div key={idx} className={`${logColor} mb-2`}>
                      {log}
                    </div>
                  );
                })}
              </div>
            </section>

          </div>

          {/* Right Column (Graph States & Backlog) */}
          <div className="flex flex-col gap-6">
            
            {/* Human Gate Actions */}
            {runDetails && runDetails.status === 'ready' && (
              <section className="bg-[#121214] border border-cyan-500/30 rounded-xl p-6 transition-all duration-200 hover:shadow-2xl hover:shadow-cyan-500/10 border-t-4 border-t-cyan-400">
                <h2 className="text-lg font-semibold mb-2 text-[#f4f4f5] flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse"></span>
                  Human Gate: Review Required
                </h2>
                <p className="text-sm text-zinc-400 mb-4">
                  The agents completed implementation, syntax parsing, and testing. Awaiting approval to commit changes.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={handleApproveChanges}
                    className="flex-1 inline-flex items-center justify-center font-semibold text-sm px-4 py-2.5 rounded-lg bg-cyan-500 text-black hover:bg-cyan-400 hover:shadow-[0_0_15px_rgba(6,182,212,0.4)] transition-all cursor-pointer"
                  >
                    Approve & Merge Code
                  </button>
                </div>
              </section>
            )}

            {/* Task Checklist */}
            {runDetails && runDetails.plan.length > 0 && (
              <section className="bg-[#121214] border border-white/8 rounded-xl p-6 transition-all duration-200 hover:border-white/16">
                <h2 className="text-md font-semibold mb-3 text-[#f4f4f5]">Decomposed Execution Plan</h2>
                <ul className="flex flex-col gap-3 list-none p-0">
                  {runDetails.plan.map((step, idx) => {
                    const isCompleted = runDetails.status === 'finished' || idx < runDetails.current_step_index;
                    const isActive = runDetails.status === 'running' && idx === runDetails.current_step_index;
                    return (
                      <li key={idx} className="flex gap-2.5 items-start text-xs leading-normal">
                        <span className={`font-bold ${isCompleted ? 'text-emerald-400' : isActive ? 'text-cyan-400' : 'text-zinc-600'}`}>
                          {isCompleted ? '✔' : isActive ? '▶' : '○'}
                        </span>
                        <div className={isCompleted ? 'text-zinc-500 line-through' : isActive ? 'text-cyan-400 font-semibold' : 'text-zinc-300'}>
                          {step}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {/* Proposed File Changes */}
            {runDetails && Object.keys(runDetails.proposed_changes).length > 0 && (
              <section className="bg-[#121214] border border-white/8 rounded-xl p-6 transition-all duration-200 hover:border-white/16 flex flex-col max-h-[400px]">
                <h2 className="text-md font-semibold mb-2 text-[#f4f4f5]">Proposed Modifications</h2>
                {Object.entries(runDetails.proposed_changes).map(([filePath, content]) => (
                  <div key={filePath} className="flex flex-col gap-2 overflow-hidden">
                    <span className="font-mono text-xs text-amber-400 bg-white/2 border border-white/8 rounded px-2 py-1 truncate">{filePath}</span>
                    <pre className="flex-1 bg-[#09090b] border border-white/8 rounded p-3 font-mono text-[11px] text-zinc-300 overflow-auto whitespace-pre leading-relaxed select-all">
                      {content}
                    </pre>
                  </div>
                ))}
              </section>
            )}

            {/* Reviewer Comments */}
            {runDetails && runDetails.review_feedback.feedback && (
              <section className="bg-[#121214] border border-white/8 rounded-xl p-6 transition-all duration-200 hover:border-white/16 border-l-4 border-l-purple-500">
                <h2 className="text-md font-semibold mb-2 text-[#f4f4f5]">Reviewer Evaluation</h2>
                <div className="text-xs text-zinc-300 italic bg-white/2 p-3 border border-white/8 rounded-lg">
                  "{runDetails.review_feedback.feedback}"
                </div>
              </section>
            )}

            {/* Jira Backlog Sidebar Widget */}
            <section className="bg-[#121214] border border-white/8 rounded-xl p-6 transition-all duration-200 hover:border-white/16 border-l-4 border-l-purple-500">
              <h2 className="text-lg font-semibold mb-2 flex items-center gap-2 text-[#f4f4f5]">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
                Jira Project Backlog
              </h2>
              <p className="text-zinc-400 text-xs mb-4">
                Manage tickets and user stories. Click "Import" to pre-fill the agent workspace prompt with ticket description requirements.
              </p>

              {/* Form to create issue */}
              <form onSubmit={handleCreateJiraIssue} className="flex flex-col gap-2.5 mb-4 border-b border-white/8 pb-4">
                <input
                  type="text"
                  placeholder="Ticket Summary..."
                  value={newJiraSummary}
                  onChange={(e) => setNewJiraSummary(e.target.value)}
                  className="bg-[#09090b] border border-white/8 rounded-lg px-3 py-2 text-[#f4f4f5] text-xs outline-none focus:border-purple-500/50"
                  required
                />
                <textarea
                  placeholder="Ticket Description/Requirements..."
                  value={newJiraDesc}
                  onChange={(e) => setNewJiraDesc(e.target.value)}
                  rows={2}
                  className="bg-[#09090b] border border-white/8 rounded-lg px-3 py-2 text-[#f4f4f5] text-xs outline-none focus:border-purple-500/50 resize-none"
                />
                <button
                  type="submit"
                  disabled={isCreatingJira || !newJiraSummary}
                  className="inline-flex items-center justify-center font-semibold text-xs px-4 py-2 rounded-lg bg-purple-500/10 border border-purple-500/30 text-purple-400 hover:bg-purple-500/20 transition-all cursor-pointer disabled:opacity-50"
                >
                  {isCreatingJira ? 'Creating...' : '+ Create Jira Ticket'}
                </button>
              </form>

              {/* Backlog List */}
              <div className="flex flex-col gap-3 max-h-[350px] overflow-y-auto pr-1">
                {jiraIssues.length === 0 ? (
                  <div className="text-center py-4 text-xs text-zinc-500">No active Jira issues found.</div>
                ) : (
                  jiraIssues.map((issue) => (
                    <div key={issue.key} className="bg-white/2 border border-white/8 rounded-lg p-3 hover:border-white/16 transition-all flex flex-col gap-2">
                      <div className="flex justify-between items-start gap-2">
                        <span className="text-[10px] font-bold font-mono text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded">
                          {issue.key}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          issue.status === 'Done' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' :
                          issue.status === 'In Progress' ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30' :
                          'bg-zinc-500/15 text-zinc-400 border border-white/8'
                        }`}>
                          {issue.status}
                        </span>
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold text-zinc-200 line-clamp-1">{issue.summary}</h4>
                        <p className="text-[11px] text-zinc-400 line-clamp-2 mt-1">{issue.description}</p>
                      </div>
                      <button
                        onClick={() => handleImportJiraStory(issue)}
                        className="mt-1 w-full inline-flex items-center justify-center font-medium text-[11px] px-3 py-1.5 rounded bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-white transition-all cursor-pointer"
                      >
                        Import Story to Prompt
                      </button>
                    </div>
                  ))
                )}
              </div>
            </section>

          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
