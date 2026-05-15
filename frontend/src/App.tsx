import { useState, useEffect } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { Dashboard } from './pages/Dashboard';
import { Portfolio } from './pages/Portfolio';
import { Agents } from './pages/Agents';
import { Markets } from './pages/Markets';
import { Config } from './pages/Config';
import { Watchlist } from './pages/Watchlist';
import { TickerResearch } from './pages/TickerResearch';
import { AlertToast } from './components/cards/AlertToast';
import { useWebSocket } from './hooks/useWebSocket';
import { usePortfolioStore } from './store/portfolio.store';
import { useConfigStore } from './store/config.store';

export type Page = 'dashboard' | 'portfolio' | 'agents' | 'markets' | 'config' | 'watchlist' | 'research';

export default function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const { status: wsStatus } = useWebSocket();
  const { fetchPortfolio, fetchHistory } = usePortfolioStore();
  const { fetchConfig, paused, setPaused } = useConfigStore();

  useEffect(() => {
    fetchPortfolio();
    fetchHistory();
    fetchConfig();
  }, [fetchPortfolio, fetchHistory, fetchConfig]);

  // Thème fixé à "dark" — le mode clair n'est pas supporté
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
  }, []);

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
          {page === 'watchlist' && <Watchlist />}
          {page === 'research' && <TickerResearch />}
        </div>
      </div>

      <AlertToast />
    </div>
  );
}
