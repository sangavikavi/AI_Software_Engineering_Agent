import { useState, useEffect } from 'react';
import './App.css';

interface SystemStatus {
  agent_active: boolean;
  database_connected: boolean;
  repositories_connected: number;
  running_jobs: number;
  api_online: boolean;
}

interface LogEntry {
  timestamp: string;
  sender: 'system' | 'planner' | 'coder' | 'reviewer' | 'tester';
  message: string;
}

function App() {
  const [status, setStatus] = useState<SystemStatus>({
    agent_active: false,
    database_connected: false,
    repositories_connected: 0,
    running_jobs: 0,
    api_online: false
  });
  
  const [repoUrl, setRepoUrl] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectedRepos, setConnectedRepos] = useState<string[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([
    { timestamp: '10:00:02', sender: 'system', message: 'AI SWE Agent Platform initialized.' },
    { timestamp: '10:00:05', sender: 'system', message: 'Awaiting repository connection...' }
  ]);

  // Fetch API Health & Status
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000';
        const healthRes = await fetch(`${apiUrl}/health`);
        const statusRes = await fetch(`${apiUrl}/api/v1/status`);
        
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
      } catch (err) {
        setStatus(prev => ({ ...prev, api_online: false }));
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleConnectRepo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrl.trim()) return;

    setIsConnecting(true);
    const mockRepo = repoUrl;
    
    // Add logs showing simulated connection steps
    const newLogs = [
      ...logs,
      { timestamp: new Date().toTimeString().split(' ')[0], sender: 'system' as const, message: `Connecting to ${mockRepo}...` }
    ];
    setLogs(newLogs);

    setTimeout(() => {
      setLogs(prev => [
        ...prev,
        { timestamp: new Date().toTimeString().split(' ')[0], sender: 'planner' as const, message: 'Repository cloned. Beginning codebase structure analysis...' },
        { timestamp: new Date().toTimeString().split(' ')[0], sender: 'planner' as const, message: 'Found 14 source files. Generating codebase vector embeddings using Hugging Face model...' }
      ]);
      
      setIsConnecting(false);
      setConnectedRepos(prev => [...prev, mockRepo]);
      setRepoUrl('');
      
      setStatus(prev => ({
        ...prev,
        repositories_connected: prev.repositories_connected + 1
      }));
    }, 2500);
  };

  const clearLogs = () => {
    setLogs([{ timestamp: new Date().toTimeString().split(' ')[0], sender: 'system', message: 'Logs cleared.' }]);
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-[#f4f4f5] font-sans">
      <div className="max-w-[1200px] mx-auto px-4 py-6 w-full">
        {/* Header */}
        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-white/8 pb-5 mb-6 gap-4">
          <div>
            <h1 className="text-2xl font-semibold font-heading flex items-center gap-2.5 text-[#f4f4f5]">
              <svg className="text-cyan-400" width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 17L12 22L22 17" stroke="var(--color-purple)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Antigravity SWE Agent Platform
            </h1>
            <p className="text-zinc-400 text-sm mt-1">
              Autonomous Multi-Agent Repository Engineering Console
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
          {/* Left Column (Main Console) */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            
            {/* Repository Connection */}
            <section className="bg-[#121214] border border-white/8 rounded-xl p-6 transition-all duration-200 hover:border-white/16 hover:shadow-2xl hover:shadow-black/40 hover:-translate-y-0.5 pulse-glow border-l-4 border-l-cyan-500">
              <h2 className="text-lg font-semibold mb-2 flex items-center gap-2 text-[#f4f4f5]">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
                </svg>
                Connect GitHub Repository
              </h2>
              <p className="text-zinc-400 text-sm mb-4">
                Clone a git repository to analyze codebase structure, generate schemas, and prepare autonomous pull requests.
              </p>
              
              <form onSubmit={handleConnectRepo} className="flex flex-col sm:flex-row gap-3">
                <input
                  type="text"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/username/repository.git"
                  disabled={isConnecting}
                  className="flex-1 bg-[#09090b] border border-white/8 rounded-lg px-4 py-2.5 text-[#f4f4f5] text-sm outline-none focus:border-cyan-500/50 transition-colors disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={isConnecting || !repoUrl}
                  className="inline-flex items-center justify-center font-medium text-sm px-5 py-2.5 rounded-lg bg-gradient-to-r from-cyan-500 to-violet-500 text-white shadow-[0_4px_14px_rgba(6,182,212,0.2)] hover:opacity-95 hover:-translate-y-0.5 hover:shadow-[0_6px_20px_rgba(6,182,212,0.35)] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:-translate-y-0"
                >
                  {isConnecting ? 'Cloning & Parsing...' : 'Connect Workspace'}
                </button>
              </form>

              {connectedRepos.length > 0 && (
                <div className="mt-4 border-t border-white/8 pt-4">
                  <h3 className="text-sm text-zinc-400 mb-2">Active Workspace Repositories:</h3>
                  <ul className="flex flex-col gap-2 list-none p-0">
                    {connectedRepos.map((repo, idx) => (
                      <li key={idx} className="bg-white/2 border border-white/8 rounded-lg px-3 py-2 flex justify-between items-center text-sm">
                        <span className="font-mono text-cyan-400 truncate max-w-[70%]">{repo}</span>
                        <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
                          Parsed & Indexed
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            {/* Agent Activity Terminal */}
            <section className="bg-[#121214] border border-white/8 rounded-xl p-6 transition-all duration-200 hover:border-white/16 hover:shadow-2xl hover:shadow-black/40 hover:-translate-y-0.5 flex flex-col flex-1 min-h-[350px]">
              <div className="flex justify-between items-center mb-3.5">
                <h2 className="text-lg font-semibold flex items-center gap-2 text-[#f4f4f5]">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="4 17 10 11 4 5" />
                    <line x1="12" y1="19" x2="20" y2="19" />
                  </svg>
                  Autonomous Agent Log Stream
                </h2>
                <button 
                  onClick={clearLogs}
                  className="bg-none border-none text-zinc-500 hover:text-zinc-300 cursor-pointer text-xs underline"
                >
                  Clear Console
                </button>
              </div>
              
              <div className="flex-1 bg-[#09090b] border border-white/8 rounded-lg p-4 font-mono text-[13px] leading-relaxed overflow-y-auto max-h-[380px]">
                {logs.map((log, idx) => {
                  let badgeColor = 'text-zinc-500';
                  if (log.sender === 'planner') badgeColor = 'text-violet-400';
                  if (log.sender === 'coder') badgeColor = 'text-cyan-400';
                  if (log.sender === 'tester') badgeColor = 'text-emerald-400';
                  if (log.sender === 'reviewer') badgeColor = 'text-orange-400';

                  return (
                    <div key={idx} className="mb-2 flex gap-2">
                      <span className="text-zinc-500">[{log.timestamp}]</span>
                      <span className={`${badgeColor} font-bold`}>{log.sender.toUpperCase()}:</span>
                      <span className="text-[#f4f4f5]">{log.message}</span>
                    </div>
                  );
                })}
              </div>
            </section>

          </div>

          {/* Right Column (Sidebar) */}
          <div className="flex flex-col gap-6">
            
            {/* Environment Health Check */}
            <section className="bg-[#121214] border border-white/8 rounded-xl p-6 transition-all duration-200 hover:border-white/16 hover:shadow-2xl hover:shadow-black/40 hover:-translate-y-0.5 border-l-4 border-l-violet-500">
              <h2 className="text-lg font-semibold mb-4 text-[#f4f4f5]">System Component Status</h2>
              <div className="flex flex-col gap-3.5">
                
                <div className="flex justify-between items-center">
                  <span className="text-sm text-zinc-400">PostgreSQL + pgvector</span>
                  {status.database_connected ? (
                    <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">Online</span>
                  ) : (
                    <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">Local SQLite</span>
                  )}
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-sm text-zinc-400">LangGraph Orchestrator</span>
                  <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">Initialized</span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-sm text-zinc-400">Hugging Face Embeddings</span>
                  <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">Loaded</span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-sm text-zinc-400">Jira Gateway</span>
                  <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">Awaiting Config</span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-sm text-zinc-400">Docker Sandbox</span>
                  <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">Idle</span>
                </div>

              </div>
            </section>

            {/* Capabilities Panel */}
            <section className="bg-[#121214] border border-white/8 rounded-xl p-6 transition-all duration-200 hover:border-white/16 hover:shadow-2xl hover:shadow-black/40 hover:-translate-y-0.5">
              <h2 className="text-lg font-semibold mb-3 text-[#f4f4f5]">Agent Capabilities</h2>
              <ul className="flex flex-col gap-3.5 list-none p-0">
                <li className="flex gap-2.5 items-start text-sm">
                  <span className="text-cyan-400 mt-0.5">✔</span>
                  <div>
                    <strong className="text-[#f4f4f5]">Semantic Search:</strong> Chunking codebase and creating embeddings with local free Hugging Face model (`all-MiniLM-L6-v2`).
                  </div>
                </li>
                <li className="flex gap-2.5 items-start text-sm">
                  <span className="text-cyan-400 mt-0.5">✔</span>
                  <div>
                    <strong className="text-[#f4f4f5]">Multi-Agent Core:</strong> Specialized agents (Planner, Coder, Reviewer, Tester) running on LangGraph.
                  </div>
                </li>
                <li className="flex gap-2.5 items-start text-sm">
                  <span className="text-cyan-400 mt-0.5">✔</span>
                  <div>
                    <strong className="text-[#f4f4f5]">Pull Requests:</strong> Code implementation, unit testing inside local Docker/Shell sandbox, and issuing PRs.
                  </div>
                </li>
                <li className="flex gap-2.5 items-start text-sm">
                  <span className="text-cyan-400 mt-0.5">✔</span>
                  <div>
                    <strong className="text-[#f4f4f5]">Approval Workflows:</strong> Interactive review gates requiring human sign-off.
                  </div>
                </li>
              </ul>
            </section>

          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
