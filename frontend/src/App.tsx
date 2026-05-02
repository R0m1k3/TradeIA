import { useState, useEffect } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { Dashboard } from './pages/Dashboard';
import { Portfolio } from './pages/Portfolio';
import { Agents } from './pages/Agents';
import { Markets } from './pages/Markets';
import { Config } from './pages/Config';
import { AlertToast } from './components/cards/AlertToast';
import { useWebSocket } from './hooks/useWebSocket';
import { usePortfolioStore } from './store/portfolio.store';
import { useConfigStore } from './store/config.store';

export type Page = 'dashboard' | 'portfolio' | 'agents' | 'markets' | 'config';

export default function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const { status: wsStatus } = useWebSocket();
  const { fetchPortfolio, fetchHistory } = usePortfolioStore();
  const { fetchConfig, paused, setPaused } = useConfigStore();

  useEffect(() => {
    fetchPortfolio();
    fetchHistory();
    fetchConfig();
  }, [fetchPortfolio, fetchHistory, fetchConfig]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <div className="app-layout" data-screen-label={page}>
      <Sidebar page={page} setPage={setPage} wsStatus={wsStatus} />
      <div className="main-panel">
        <TopBar paused={paused} onToggleRun={() => setPaused(!paused)} />
        <div className="scroll">
          {page === 'dashboard' && <Dashboard onNavigate={setPage} />}
          {page === 'portfolio' && <Portfolio />}
          {page === 'agents' && <Agents />}
          {page === 'markets' && <Markets />}
          {page === 'config' && <Config />}
        </div>
      </div>

      {/* Theme toggle */}
      <button
        onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        style={{
          position: 'fixed',
          bottom: 18,
          right: 18,
          zIndex: 50,
          width: 40,
          height: 40,
          borderRadius: '50%',
          border: '1px solid var(--rule-strong)',
          background: 'var(--bg-elev)',
          color: 'var(--ink-2)',
          cursor: 'pointer',
          fontSize: 16,
          boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
        }}
        title="Changer thème"
      >
        {theme === 'dark' ? '☀' : '☾'}
      </button>

      <AlertToast />
    </div>
  );
}
