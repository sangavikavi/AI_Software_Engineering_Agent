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

type Page = 'workspace' | 'repos' | 'sandbox' | 'git' | 'jira';

function App() {
  const [status, setStatus] = useState<SystemStatus>({
    agent_active: false,
    database_connected: false,
    repositories_connected: 0,
    running_jobs: 0,
    api_online: false
  });
  
  // Navigation Page routing state
  const [currentPage, setCurrentPage] = useState<Page>('workspace');
  
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
          
          if (data.status === 'finished' || data.status === 'failed') {
            setActiveRunId(null);
            fetchInitialData();
          }
        }
      } catch (err) {
        console.error('Error polling agent run status:', err);
      }
    };

    pollRunStatus();
    const interval = setInterval(pollRunStatus, 1000);
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
    setCurrentPage('workspace');
  };

  // Helper: Active Node checker for LangGraph Visualizer
  const getNodeClass = (node: 'planner' | 'coder' | 'tester' | 'reviewer' | 'ready') => {
    if (!runDetails) return 'flow-node';
    const status = runDetails.status;
    
    const mapping: Record<string, string> = {
      'planning': 'planner',
      'coding': 'coder',
      'testing': 'tester',
      'reviewing': 'reviewer',
      'ready': 'ready'
    };
    
    if (status === 'finished') {
      return 'flow-node flow-node-completed';
    }
    
    if (mapping[status] === node) {
      return 'flow-node flow-node-active';
    }
    
    const order = ['planner', 'coder', 'tester', 'reviewer', 'ready'];
    const currentIdx = order.indexOf(mapping[status] || '');
    const nodeIdx = order.indexOf(node);
    
    if (nodeIdx < currentIdx && currentIdx !== -1) {
      return 'flow-node flow-node-completed';
    }
    
    return 'flow-node';
  };

  const activeRepo = repositories.find(r => r.id === selectedRepoId);

  // ==================== RENDERING PAGES ====================

  // Page 1: Workspace Console
  const renderWorkspacePage = () => (
    <div className="flex flex-col gap-6 w-full animate-fade-in">
      
      {/* LangGraph Active Flowchart Map */}
      {runDetails && (
        <section className="glass-panel p-5 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase font-bold text-indigo-500 tracking-wider">LangGraph Cognitive Flow</span>
            <span className="text-sm font-bold text-slate-800 mt-0.5">Active State Transitions</span>
          </div>
          
          <div className="flex flex-wrap items-center justify-center gap-3.5 text-xs font-semibold font-mono">
            <div className={getNodeClass('planner')}>
              <span className="text-[9px] text-zinc-500 font-bold uppercase">Node 1</span>
              <span className="mt-0.5">Planner</span>
            </div>
            <span className="text-slate-400 font-bold">➔</span>
            <div className={getNodeClass('coder')}>
              <span className="text-[9px] text-zinc-500 font-bold uppercase">Node 2</span>
              <span className="mt-0.5">Coder</span>
            </div>
            <span className="text-slate-400 font-bold">➔</span>
            <div className={getNodeClass('tester')}>
              <span className="text-[9px] text-zinc-500 font-bold uppercase">Node 3</span>
              <span className="mt-0.5">Tester</span>
            </div>
            <span className="text-slate-400 font-bold">➔</span>
            <div className={getNodeClass('reviewer')}>
              <span className="text-[9px] text-zinc-500 font-bold uppercase">Node 4</span>
              <span className="mt-0.5">Reviewer</span>
            </div>
            <span className="text-slate-400 font-bold">➔</span>
            <div className={getNodeClass('ready')}>
              <span className="text-[9px] text-zinc-500 font-bold uppercase">Gate</span>
              <span className="mt-0.5">Approval</span>
            </div>
          </div>
        </section>
      )}

      {/* Workspace split layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Terminal logs and instruction input */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          <section className="glass-panel p-6 rounded-2xl">
            <h2 className="text-lg font-bold mb-2 flex items-center gap-2 text-slate-850">
              <svg className="text-indigo-500" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              Autonomous Agent Prompt Console
            </h2>
            <p className="text-slate-500 text-xs mb-4">
              Submit requirements or instructions. The agent will run background compilations and output clean diff packages.
            </p>
            
            <form onSubmit={handleRunAgent} className="flex gap-3">
              <input
                type="text"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder={selectedRepoId === null ? "Please select/connect a repository first..." : "E.g. add a GET route for /api/v1/healthcheck"}
                disabled={isSubmittingRun || activeRunId !== null || selectedRepoId === null}
                className="flex-1 custom-input"
                required
              />
              <button
                type="submit"
                disabled={isSubmittingRun || activeRunId !== null || !instruction || selectedRepoId === null}
                className="inline-flex items-center justify-center font-bold text-xs px-6 py-2.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 shadow-md hover:shadow-lg transition-all cursor-pointer disabled:opacity-50"
              >
                {isSubmittingRun || activeRunId !== null ? 'RUNNING...' : 'EXECUTE'}
              </button>
            </form>
          </section>

          <section className="glass-panel p-6 rounded-2xl flex flex-col flex-1 min-h-[380px]">
            <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-3">
              <h2 className="text-lg font-bold flex items-center gap-2 text-slate-850">
                <svg className="text-slate-600" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 17 10 11 4 5" />
                  <line x1="12" y1="19" x2="20" y2="19" />
                </svg>
                Terminal Event logs
              </h2>
              <span className="text-[10px] font-mono font-bold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-full border border-slate-200">
                {runDetails ? `STATE: ${runDetails.status.toUpperCase()}` : 'CONSOLE STANDBY'}
              </span>
            </div>
            
            <div className="flex-1 bg-slate-50 border border-slate-200 rounded-xl p-4 font-mono text-[13px] leading-7 overflow-y-auto max-h-[350px] shadow-inner">
              {logs.map((log, idx) => {
                let logClass = "text-slate-800";
                if (log.toLowerCase().includes("error")) logClass = "text-rose-650 font-bold";
                else if (log.toLowerCase().includes("system:")) logClass = "text-cyan-650 font-bold";
                else if (log.toLowerCase().includes("planner:")) logClass = "text-indigo-650 font-semibold";
                else if (log.toLowerCase().includes("coder:")) logClass = "text-amber-650 font-semibold";
                else if (log.toLowerCase().includes("tester:")) logClass = "text-emerald-650 font-semibold";
                else if (log.toLowerCase().includes("reviewer:")) logClass = "text-purple-650 font-bold";

                return (
                  <div key={idx} className={`${logClass} mb-2`}>
                    {log}
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* Planner Task List & Sidebar */}
        <div className="flex flex-col gap-6">
          {runDetails && runDetails.plan.length > 0 ? (
            <section className="glass-panel p-6 rounded-2xl">
              <h2 className="text-sm font-semibold mb-3.5 text-slate-800 border-b border-slate-100 pb-2">Planner Task List</h2>
              <div className="flex flex-col gap-3.5">
                {runDetails.plan.map((step, idx) => {
                  const isCompleted = runDetails.status === 'finished' || idx < runDetails.current_step_index;
                  const isActive = runDetails.status === 'running' && idx === runDetails.current_step_index;
                  
                  return (
                    <div key={idx} className="flex gap-3 items-start text-[12px] leading-relaxed">
                      <span className={`font-bold text-[14px] ${isCompleted ? 'text-emerald-600' : isActive ? 'text-indigo-650' : 'text-slate-400'}`}>
                        {isCompleted ? '✔' : isActive ? '▶' : '○'}
                      </span>
                      <div className={isCompleted ? 'text-slate-400 line-through' : isActive ? 'text-indigo-650 font-bold' : 'text-slate-700 font-semibold'}>
                        {step}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : (
            <section className="glass-panel p-6 rounded-2xl text-center py-12">
              <span className="text-slate-400 text-4xl">📋</span>
              <h3 className="text-sm font-bold mt-3 text-slate-700">No active execution plan</h3>
              <p className="text-[11px] text-slate-500 mt-1.5 max-w-[200px] mx-auto">Submit an instruction above to see the agent decompose it into steps.</p>
            </section>
          )}

          {runDetails && runDetails.review_feedback.feedback && (
            <section className="glass-panel p-6 rounded-2xl border-l-4 border-l-purple-500 animate-fade-in">
              <h2 className="text-sm font-semibold mb-2 text-slate-800">Review Board Comments</h2>
              <p className="text-xs text-slate-700 italic bg-slate-50 p-4 border border-slate-200 rounded-lg leading-relaxed shadow-sm">
                "{runDetails.review_feedback.feedback}"
              </p>
            </section>
          )}
        </div>

      </div>
    </div>
  );

  // Page 2: Codebase Repos
  const renderReposPage = () => (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 w-full animate-fade-in">
      
      {/* Repository Connector Form */}
      <section className="glass-panel p-6 rounded-2xl lg:col-span-1 h-fit">
        <h2 className="text-lg font-semibold mb-2 flex items-center gap-2 text-slate-850">
          <svg className="text-indigo-500" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          Connect Codebase Repository
        </h2>
        <p className="text-slate-500 text-xs mb-4">
          Provide repository details to configure git workspaces, compute indexes, and trigger embedding parsers.
        </p>
        
        <form onSubmit={handleConnectRepo} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Workspace Tag</label>
            <input
              type="text"
              value={repoName}
              onChange={(e) => setRepoName(e.target.value)}
              placeholder="E.g. website-core"
              disabled={isConnecting}
              className="custom-input"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Git Clone HTTPS URL</label>
            <input
              type="text"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/..."
              disabled={isConnecting}
              className="custom-input"
              required
            />
          </div>
          <button
            type="submit"
            disabled={isConnecting || !repoUrl || !repoName}
            className="mt-2 w-full inline-flex items-center justify-center font-bold text-xs px-5 py-2.5 rounded-lg bg-indigo-650 text-white hover:bg-indigo-650/95 shadow-md hover:shadow-lg transition-all cursor-pointer disabled:opacity-50"
          >
            {isConnecting ? 'Cloning & Parsing...' : 'Connect Git URL'}
          </button>
        </form>
      </section>

      {/* Repositories List */}
      <section className="glass-panel p-6 rounded-2xl lg:col-span-2">
        <h2 className="text-lg font-semibold mb-4 text-slate-800 border-b border-slate-100 pb-2">Registered Codebases</h2>
        
        {repositories.length === 0 ? (
          <div className="text-center py-12 text-sm text-slate-500">No active repositories indexed. Connect one on the left panel.</div>
        ) : (
          <div className="flex flex-col gap-4">
            {repositories.map((repo) => (
              <div
                key={repo.id}
                onClick={() => setSelectedRepoId(repo.id)}
                className={`p-5 rounded-xl border transition-all cursor-pointer flex flex-col md:flex-row justify-between items-start md:items-center gap-4 ${
                  selectedRepoId === repo.id
                    ? 'bg-indigo-50/50 border-indigo-500 shadow-md'
                    : 'bg-white border-slate-200 hover:border-slate-350 shadow-sm'
                }`}
              >
                <div className="flex items-start gap-3.5">
                  <span className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-lg text-slate-500 border border-slate-200">
                    📁
                  </span>
                  <div>
                    <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                      {repo.name}
                      {selectedRepoId === repo.id && (
                        <span className="text-[9px] bg-indigo-50 border border-indigo-150 text-indigo-700 px-2 py-0.5 rounded font-mono uppercase tracking-wider font-bold">SELECTED</span>
                      )}
                    </h3>
                    <p className="text-[11px] text-slate-500 font-mono mt-1">{repo.clone_url}</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-3 font-mono text-[11px] flex-wrap">
                  <div className="flex gap-1.5">
                    <span className="text-slate-400">PATH:</span>
                    <span className="text-slate-700 truncate max-w-[120px] font-bold">{repo.local_path}</span>
                  </div>
                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                    repo.status === 'ready' 
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                      : 'bg-amber-50 text-amber-700 border-amber-200'
                  }`}>
                    {repo.status.toUpperCase()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

    </div>
  );

  // Page 3: Sandbox Runner
  const renderSandboxPage = () => (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 w-full animate-fade-in">
      
      {/* Environment Status info */}
      <section className="glass-panel p-6 rounded-2xl lg:col-span-1 flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-slate-805 flex items-center gap-2">
          <span className="text-emerald-500">🧪</span>
          Sandbox Environment
        </h2>
        <p className="text-slate-600 text-xs leading-relaxed font-medium">
          The Sandbox runner copies your repository code to a sandboxed directory, overlays the coder edits, compile checks, and executes unit tests (pytest).
        </p>
        
        <div className="border-t border-slate-100 pt-4 flex flex-col gap-3.5 font-mono text-xs">
          <div className="flex justify-between border-b border-slate-100 pb-2">
            <span className="text-slate-400">ENGINE:</span>
            <span className="text-slate-800 font-bold">Local OS Subprocess</span>
          </div>
          <div className="flex justify-between border-b border-slate-100 pb-2">
            <span className="text-slate-400">SANDBOX ROOT:</span>
            <span className="text-slate-800 font-bold">backend/temp_sandboxes/</span>
          </div>
          <div className="flex justify-between border-b border-slate-100 pb-2">
            <span className="text-slate-400">ISOLATION:</span>
            <span className="text-emerald-600 font-bold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              Folder Sandboxed
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">CLEANUP AGENT:</span>
            <span className="text-slate-800 font-bold">Active (Auto rm -rf)</span>
          </div>
        </div>
      </section>

      {/* Sandbox Test Logs */}
      <section className="glass-panel p-6 rounded-2xl lg:col-span-2 min-h-[400px] flex flex-col">
        <h2 className="text-lg font-semibold text-slate-805 mb-2">Sandbox Test Outputs</h2>
        <p className="text-slate-500 text-xs mb-4">Live syntax check and test execution details for the latest agent run.</p>
        
        {runDetails && runDetails.test_results && Object.keys(runDetails.test_results).length > 0 ? (
          <div className="flex-1 flex flex-col gap-5">
            <div className="grid grid-cols-3 gap-4">
              <div className={`p-4 rounded-xl border text-center ${
                runDetails.test_results.success 
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-800' 
                  : 'bg-rose-50 border-rose-300 text-rose-800'
              }`}>
                <div className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Status</div>
                <div className="text-base font-extrabold mt-1">
                  {runDetails.test_results.success ? 'PASSED' : 'FAILED'}
                </div>
              </div>
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-center">
                <div className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Tests Checked</div>
                <div className="text-base font-extrabold mt-1 text-slate-800">{runDetails.test_results.test_run_count || 0}</div>
              </div>
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-center">
                <div className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Failures Caught</div>
                <div className="text-base font-extrabold mt-1 text-slate-800">{runDetails.test_results.failures || 0}</div>
              </div>
            </div>
            
            <div className="flex-1 bg-slate-50 border border-slate-200 rounded-xl p-4 font-mono text-xs overflow-auto max-h-[300px] text-slate-800 shadow-inner">
              <pre className="whitespace-pre-wrap leading-relaxed">{runDetails.test_results.logs || 'No log details logged.'}</pre>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
            <span className="text-4xl">🔍</span>
            <span className="text-sm mt-3 font-bold text-slate-600">No sandboxed tests recorded</span>
            <p className="text-xs text-slate-500 mt-1">Start a run to compile edits in the sandbox workspace.</p>
          </div>
        )}
      </section>

    </div>
  );

  // Page 4: Git & PR Manager
  const renderGitPage = () => (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 w-full animate-fade-in">
      
      {/* Gate Controls & PR URL */}
      <section className="glass-panel p-6 rounded-2xl lg:col-span-1 flex flex-col gap-4 h-fit">
        <h2 className="text-lg font-semibold text-slate-805 flex items-center gap-2">
          <span className="text-indigo-500">🌳</span>
          Git & GitHub Manager
        </h2>
        
        {runDetails && runDetails.status === 'ready' && (
          <div className="bg-cyan-50 border border-cyan-300 p-4 rounded-xl flex flex-col gap-2.5 shadow-sm">
            <h3 className="text-xs font-bold text-cyan-800 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-cyan-500 animate-ping"></span>
              Human Gate Approval Ready
            </h3>
            <p className="text-[11.5px] text-cyan-900 leading-relaxed font-semibold">
              All code edits and pytest evaluations passed. Approve to checkout patch branch, commit, push changes, and open a GitHub Pull Request.
            </p>
            <button
              onClick={handleApproveChanges}
              className="mt-1.5 w-full inline-flex items-center justify-center font-bold text-xs px-4 py-2.5 rounded-lg bg-cyan-600 text-white hover:bg-cyan-500 transition-all cursor-pointer shadow"
            >
              Approve & Open PR
            </button>
          </div>
        )}

        {/* PR URL Result Badge */}
        {runDetails && runDetails.status === 'finished' && runDetails.history_logs.some(l => l.includes("Pull Request created")) && (
          <div className="bg-indigo-50 border border-indigo-200 p-5 rounded-xl flex flex-col gap-3 shadow-sm animate-fade-in">
            <h3 className="text-xs font-bold text-indigo-700 flex items-center gap-1">
              🎉 Pull Request Created
            </h3>
            <p className="text-[11.5px] text-indigo-900 leading-normal font-semibold">
              Autonomous patch merged and pushed! Open the branch changes on GitHub.
            </p>
            {(() => {
              const prLog = runDetails.history_logs.find(l => l.includes("Pull Request created"));
              const prUrl = prLog ? prLog.split("Link: ")[1] : null;
              if (prUrl) {
                return (
                  <a
                    href={prUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full inline-flex items-center justify-center font-bold text-xs px-4 py-2.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 shadow-md transition-all text-center cursor-pointer"
                  >
                    View PR on GitHub ↗
                  </a>
                );
              }
              return null;
            })()}
          </div>
        )}

        <div className="border-t border-slate-100 pt-4 flex flex-col gap-3.5 font-mono text-xs">
          <div className="flex justify-between border-b border-slate-100 pb-2">
            <span className="text-slate-400">REMOTE ORIGIN:</span>
            <span className="text-slate-800 font-bold truncate max-w-[130px]">{activeRepo?.clone_url || 'None'}</span>
          </div>
          <div className="flex justify-between border-b border-slate-100 pb-2">
            <span className="text-slate-400">PATCH BRANCH:</span>
            <span className="text-slate-800 font-bold">swe-agent/patch-*</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">TARGET BASE:</span>
            <span className="text-slate-800 font-bold">main / master</span>
          </div>
        </div>
      </section>

      {/* Code Diffs Viewer */}
      <section className="glass-panel p-6 rounded-2xl lg:col-span-2 flex flex-col min-h-[400px]">
        <h2 className="text-lg font-semibold text-slate-805 mb-2">Proposed Code Changes</h2>
        <p className="text-slate-500 text-xs mb-4">View file edits formulated by the multi-agent graph.</p>
        
        {runDetails && Object.keys(runDetails.proposed_changes).length > 0 ? (
          <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-5 max-h-[450px]">
            {Object.entries(runDetails.proposed_changes).map(([filePath, content]) => (
              <div key={filePath} className="border border-slate-200 rounded-lg overflow-hidden flex flex-col shadow">
                <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5 flex items-center justify-between">
                  <span className="font-mono text-xs text-indigo-650 font-bold truncate max-w-[300px]">{filePath}</span>
                  <span className="text-[9px] text-slate-400 font-bold uppercase font-mono tracking-wider">COMPLETE FILE</span>
                </div>
                
                <div className="diff-code-editor max-h-[300px] overflow-auto p-2">
                  {content.split('\n').map((line, lineIdx) => (
                    <div key={lineIdx} className="diff-line flex font-mono text-[11px] leading-relaxed">
                      <span className="text-zinc-500 select-none text-right pr-4 w-9 border-r border-zinc-800 font-semibold">{lineIdx + 1}</span>
                      <span className="text-zinc-200 pl-4 font-medium whitespace-pre">{line}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-450">
            <span className="text-4xl">📁</span>
            <span className="text-sm mt-3 font-bold text-slate-600">No code changes proposed yet</span>
            <p className="text-xs text-slate-500 mt-1">Start a run to see diff packages.</p>
          </div>
        )}
      </section>

    </div>
  );

  // Page 5: Jira Board
  const renderJiraPage = () => (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 w-full animate-fade-in">
      
      {/* Create Jira Story Form */}
      <section className="glass-panel p-6 rounded-2xl lg:col-span-1 h-fit">
        <h2 className="text-lg font-semibold mb-2 flex items-center gap-2 text-slate-850">
          <svg className="text-indigo-500" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Create Jira Story
        </h2>
        <p className="text-slate-500 text-xs mb-4">
          Log user stories or bugs in the Jira project workspace. Supports sync with Jira Cloud or local fallback storage.
        </p>
        
        <form onSubmit={handleCreateJiraIssue} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Ticket Summary</label>
            <input
              type="text"
              placeholder="Fix route path prefix"
              value={newJiraSummary}
              onChange={(e) => setNewJiraSummary(e.target.value)}
              disabled={isCreatingJira}
              className="custom-input"
              required
            />
          </div>
          
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Ticket Description / Requirements</label>
            <textarea
              placeholder="Detail step validations..."
              value={newJiraDesc}
              onChange={(e) => setNewJiraDesc(e.target.value)}
              disabled={isCreatingJira}
              rows={4}
              className="custom-input h-28 resize-none"
            />
          </div>
          
          <button
            type="submit"
            disabled={isCreatingJira || !newJiraSummary}
            className="mt-1 w-full inline-flex items-center justify-center font-semibold text-xs px-5 py-2.5 rounded-lg bg-indigo-650 text-white hover:bg-indigo-650/95 shadow transition-all cursor-pointer disabled:opacity-50"
          >
            {isCreatingJira ? 'Creating...' : '+ Log Ticket'}
          </button>
        </form>
      </section>

      {/* Kanban Board Columns (Backlog, In Progress, Done) */}
      <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-4">
        
        {/* 1. Backlog Column */}
        <div className="flex flex-col gap-4 bg-purple-50/50 border border-purple-100 p-4 rounded-2xl min-h-[480px]">
          <h3 className="text-[11px] uppercase font-extrabold text-purple-700 tracking-widest flex justify-between items-center px-1 border-b border-purple-100 pb-2">
            <span>Backlog</span>
            <span className="bg-purple-100 text-purple-700 border border-purple-200 px-2 py-0.5 rounded text-[10px] font-extrabold">
              {jiraIssues.filter(i => i.status === 'Backlog').length}
            </span>
          </h3>
          
          <div className="flex flex-col gap-3.5 overflow-y-auto max-h-[500px] pr-1">
            {jiraIssues.filter(i => i.status === 'Backlog').map(issue => (
              <div key={issue.key} className="bg-white border border-slate-200 hover:border-slate-350 p-4 rounded-xl flex flex-col gap-3.5 shadow-sm hover:shadow-md transition-all">
                <span className="text-[9px] font-mono font-bold text-purple-700 bg-purple-100/70 px-2 py-0.5 rounded w-fit border border-purple-200/50">{issue.key}</span>
                <div>
                  <h4 className="text-xs font-bold text-slate-900 leading-normal">{issue.summary}</h4>
                  <p className="text-[10.5px] text-slate-600 mt-1 line-clamp-3 leading-relaxed font-medium">{issue.description}</p>
                </div>
                <button
                  onClick={() => handleImportJiraStory(issue)}
                  className="mt-1 w-full inline-flex items-center justify-center font-bold text-[10px] px-2.5 py-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-500 shadow-sm transition-all cursor-pointer"
                >
                  Import & Execute
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* 2. In Progress Column */}
        <div className="flex flex-col gap-4 bg-cyan-50/50 border border-cyan-100 p-4 rounded-2xl min-h-[480px]">
          <h3 className="text-[11px] uppercase font-extrabold text-cyan-700 tracking-widest flex justify-between items-center px-1 border-b border-cyan-100 pb-2">
            <span>In Progress</span>
            <span className="bg-cyan-100 text-cyan-700 border border-cyan-200 px-2 py-0.5 rounded text-[10px] font-extrabold">
              {jiraIssues.filter(i => i.status === 'In Progress').length}
            </span>
          </h3>
          
          <div className="flex flex-col gap-3.5 overflow-y-auto max-h-[500px] pr-1">
            {jiraIssues.filter(i => i.status === 'In Progress').map(issue => (
              <div key={issue.key} className="bg-white border border-slate-200 hover:border-slate-350 p-4 rounded-xl flex flex-col gap-3.5 shadow-sm hover:shadow-md transition-all border-l-2 border-l-cyan-500">
                <span className="text-[9px] font-mono font-bold text-cyan-700 bg-cyan-100/70 px-2 py-0.5 rounded w-fit border border-cyan-200/50">{issue.key}</span>
                <div>
                  <h4 className="text-xs font-bold text-slate-900 leading-normal">{issue.summary}</h4>
                  <p className="text-[10.5px] text-slate-600 mt-1 line-clamp-3 leading-relaxed font-medium">{issue.description}</p>
                </div>
                <button
                  onClick={() => handleImportJiraStory(issue)}
                  className="mt-1 w-full inline-flex items-center justify-center font-bold text-[10px] px-2.5 py-1.5 rounded bg-indigo-650 text-white hover:bg-indigo-500 shadow-sm transition-all cursor-pointer"
                >
                  Import Story
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* 3. Done Column */}
        <div className="flex flex-col gap-4 bg-emerald-50/40 border border-emerald-100 p-4 rounded-2xl min-h-[480px]">
          <h3 className="text-[11px] uppercase font-extrabold text-emerald-700 tracking-widest flex justify-between items-center px-1 border-b border-emerald-100 pb-2">
            <span>Done</span>
            <span className="bg-emerald-100 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded text-[10px] font-extrabold">
              {jiraIssues.filter(i => i.status === 'Done').length}
            </span>
          </h3>
          
          <div className="flex flex-col gap-3.5 overflow-y-auto max-h-[500px] pr-1">
            {jiraIssues.filter(i => i.status === 'Done').map(issue => (
              <div key={issue.key} className="bg-white border border-slate-200/70 p-4 rounded-xl flex flex-col gap-3 opacity-60 border-l-2 border-l-emerald-500 shadow-sm">
                <span className="text-[9px] font-mono font-bold text-emerald-700 bg-emerald-100/70 px-2 py-0.5 rounded w-fit border border-emerald-200/50">{issue.key}</span>
                <div>
                  <h4 className="text-xs font-bold text-slate-800 leading-normal line-through">{issue.summary}</h4>
                  <p className="text-[10.5px] text-slate-500 mt-1 line-clamp-3 leading-relaxed font-medium">{issue.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

    </div>
  );

  // ==================== MAIN COMPONENT FRAME ====================

  return (
    <div className="flex h-screen w-screen overflow-hidden light-grid-bg">

      {/* 1. LEFT SIDEBAR NAVIGATION */}
      <aside className="w-[260px] h-full flex flex-col bg-slate-50 border-r border-slate-200 z-20 flex-shrink-0">
        
        {/* Brand logo */}
        <div className="p-5 border-b border-slate-200 flex items-center gap-3">
          <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center text-sm font-bold text-white shadow-[0_0_15px_rgba(99,102,241,0.35)] animate-pulse">
            SC
          </span>
          <div>
            <h1 className="text-sm font-extrabold text-slate-800 tracking-wider font-heading">SWE WORKSPACE</h1>
            <span className="text-[9px] text-slate-500 font-bold font-mono">v1.2.0 // DEPLOYED</span>
          </div>
        </div>

        {/* Navigation list */}
        <nav className="flex-1 p-4 flex flex-col gap-2.5 overflow-y-auto">
          <button
            onClick={() => setCurrentPage('workspace')}
            className={`w-full px-4 py-3 rounded-xl text-xs font-bold flex items-center gap-3 transition-all cursor-pointer ${
              currentPage === 'workspace'
                ? 'bg-indigo-50 border border-indigo-200 text-indigo-700 shadow-sm'
                : 'text-slate-650 hover:text-slate-900 hover:bg-slate-100/80 border border-transparent'
            }`}
          >
            <span className="text-sm">🚀</span>
            Workspace Console
          </button>
          
          <button
            onClick={() => setCurrentPage('repos')}
            className={`w-full px-4 py-3 rounded-xl text-xs font-bold flex items-center gap-3 transition-all cursor-pointer ${
              currentPage === 'repos'
                ? 'bg-indigo-50 border border-indigo-200 text-indigo-700 shadow-sm'
                : 'text-slate-650 hover:text-slate-900 hover:bg-slate-100/80 border border-transparent'
            }`}
          >
            <span className="text-sm">📁</span>
            Codebase Repos
          </button>
          
          <button
            onClick={() => setCurrentPage('sandbox')}
            className={`w-full px-4 py-3 rounded-xl text-xs font-bold flex items-center gap-3 transition-all cursor-pointer ${
              currentPage === 'sandbox'
                ? 'bg-indigo-50 border border-indigo-200 text-indigo-700 shadow-sm'
                : 'text-slate-650 hover:text-slate-900 hover:bg-slate-100/80 border border-transparent'
            }`}
          >
            <span className="text-sm">🧪</span>
            Sandbox Runner
          </button>
          
          <button
            onClick={() => setCurrentPage('git')}
            className={`w-full px-4 py-3 rounded-xl text-xs font-bold flex items-center gap-3 transition-all cursor-pointer ${
              currentPage === 'git'
                ? 'bg-indigo-50 border border-indigo-200 text-indigo-700 shadow-sm'
                : 'text-slate-655 hover:text-slate-900 hover:bg-slate-100/80 border border-transparent'
            }`}
          >
            <span className="text-sm">🌳</span>
            Git & PR Manager
          </button>
          
          <button
            onClick={() => setCurrentPage('jira')}
            className={`w-full px-4 py-3 rounded-xl text-xs font-bold flex items-center gap-3 transition-all cursor-pointer ${
              currentPage === 'jira'
                ? 'bg-indigo-50 border border-indigo-200 text-indigo-700 shadow-sm'
                : 'text-slate-650 hover:text-slate-900 hover:bg-slate-100/80 border border-transparent'
            }`}
          >
            <span className="text-sm">📋</span>
            Jira Board
          </button>
        </nav>

        {/* Connectivity status */}
        <div className="p-4 border-t border-slate-200 flex flex-col gap-2 font-mono text-[9px] text-slate-500 bg-slate-100/80">
          <div className="flex justify-between items-center">
            <span>API SERVER:</span>
            <span className={`font-bold ${status.api_online ? 'text-emerald-600' : 'text-rose-650'}`}>
              {status.api_online ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span>DATABASE:</span>
            <span className={`font-bold ${status.database_connected ? 'text-emerald-600' : 'text-amber-650'}`}>
              {status.database_connected ? 'CONNECTED' : 'IDLE'}
            </span>
          </div>
        </div>

      </aside>

      {/* 2. MAIN CONTENT AREA */}
      <main className="flex-1 h-full overflow-y-auto p-6 flex flex-col">
        
        {/* Top Navbar */}
        <div className="flex justify-between items-center border-b border-slate-200 pb-4 mb-6 flex-shrink-0">
          <div>
            <h2 className="text-xl font-extrabold text-slate-800 uppercase font-heading tracking-wide">
              {currentPage === 'workspace' && '🚀 Workspace Terminal'}
              {currentPage === 'repos' && '📁 Codebase Repositories'}
              {currentPage === 'sandbox' && '🧪 Execution Sandbox'}
              {currentPage === 'git' && '🌳 Git Version Control'}
              {currentPage === 'jira' && '📋 Atlassian Jira Board'}
            </h2>
            <p className="text-[10px] text-slate-450 uppercase tracking-widest font-mono mt-1 font-bold">
              {currentPage === 'workspace' && 'LOG LOOPS // COGNITIVE AGENTS ORCHESTRATION'}
              {currentPage === 'repos' && 'CLONE Workspaces // DIRECTORY INDEXING'}
              {currentPage === 'sandbox' && 'PYTEST RUNNERS // SYNTAX VALIDATION'}
              {currentPage === 'git' && 'BRANCH MANAGEMENT // PULL REQUESTS'}
              {currentPage === 'jira' && 'USER STORIES // REQUIREMENT LOGGING'}
            </p>
          </div>

          {activeRepo && (
            <span className="text-[10.5px] font-mono border border-slate-200 bg-white px-3.5 py-1.5 rounded-full text-slate-600 font-bold shadow-sm">
              Active Workspace: {activeRepo.name}
            </span>
          )}
        </div>

        {/* Real-time statistics telemetry panel (only on Workspace) */}
        {currentPage === 'workspace' && (
          <section className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 mb-6 flex-shrink-0">
            <div className="glass-panel p-3.5 rounded-xl flex flex-col">
              <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Embeddings</span>
              <span className="text-[11.5px] font-bold text-slate-700 mt-1 truncate">all-MiniLM-L6 (Local CPU)</span>
            </div>
            <div className="glass-panel p-3.5 rounded-xl flex flex-col">
              <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Search Latency</span>
              <span className="text-[11.5px] font-bold text-slate-700 mt-1 font-mono">&lt; 2ms (NumPy store)</span>
            </div>
            <div className="glass-panel p-3.5 rounded-xl flex flex-col">
              <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Active Loops</span>
              <span className="text-[11.5px] font-bold text-slate-700 mt-1 font-mono">{runDetails?.iterations || 0} / 4 loops</span>
            </div>
            <div className="glass-panel p-3.5 rounded-xl flex flex-col">
              <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">System State</span>
              <span className={`text-[11.5px] font-bold mt-1 flex items-center gap-1.5 ${
                runDetails?.status === 'testing' ? 'text-cyan-600' : 'text-slate-600'
              }`}>
                {runDetails?.status === 'testing' ? 'Running Tests' : 'Ready'}
              </span>
            </div>
          </section>
        )}

        {/* Main page view */}
        <div className="flex-1 w-full flex">
          {currentPage === 'workspace' && renderWorkspacePage()}
          {currentPage === 'repos' && renderReposPage()}
          {currentPage === 'sandbox' && renderSandboxPage()}
          {currentPage === 'git' && renderGitPage()}
          {currentPage === 'jira' && renderJiraPage()}
        </div>

      </main>
    </div>
  );
}

export default App;
