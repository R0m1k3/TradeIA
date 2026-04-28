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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { status: wsStatus } = useWebSocket();
  const { fetchPortfolio, fetchHistory } = usePortfolioStore();
  const { fetchConfig } = useConfigStore();

  useEffect(() => {
    fetchPortfolio();
    fetchHistory();
    fetchConfig();
  }, [fetchPortfolio, fetchHistory, fetchConfig]);

  return (
    <div className="flex h-screen overflow-hidden bg-bg-base">
      <Sidebar
        activePage={page}
        onNavigate={setPage}
        wsStatus={wsStatus}
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((o) => !o)}
      />

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopBar onMenuToggle={() => setSidebarOpen((o) => !o)} />

        <main className="flex-1 overflow-auto p-4">
          {page === 'dashboard' && <Dashboard onNavigate={setPage} />}
          {page === 'portfolio' && <Portfolio />}
          {page === 'agents' && <Agents />}
          {page === 'markets' && <Markets />}
          {page === 'config' && <Config />}
        </main>
      </div>

      <AlertToast />
    </div>
  );
}
