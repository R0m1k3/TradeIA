import { useMemo } from 'react';
import { useSignalsStore } from '../../store/signals.store';
import { useConfigStore } from '../../store/config.store';
import type { Page } from '../../App';
import type { WsStatus } from '../../hooks/useWebSocket';

const NAV = [
  { id: 'dashboard' as Page, label: 'Tableau de bord', sub: 'Portefeuille & P&L', icon: IcDash },
  { id: 'markets' as Page, label: 'Vue Marché', sub: 'Synthèse temps réel', icon: IcMarket },
  { id: 'agents' as Page, label: 'Agents IA', sub: 'Pipeline & décisions', icon: IcAgents },
  { id: 'portfolio' as Page, label: 'Portefeuille', sub: 'Positions & décisions IA', icon: IcChart },
  { id: 'config' as Page, label: 'Configuration', sub: 'Stratégie & système', icon: IcConfig },
];

function BrandMark() {
  return (
    <svg viewBox="0 0 28 28" width="28" height="28" fill="none">
      <circle cx="14" cy="14" r="12" stroke="var(--ink-3)" strokeWidth="1.4" />
      <path
        d="M5 17 L9.5 11 L13.5 14 L22 6.5"
        stroke="var(--accent)"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="22" cy="6.5" r="1.8" fill="var(--accent)" />
    </svg>
  );
}

function IcDash() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="2" width="6" height="7" rx="1.5" />
      <rect x="10" y="2" width="6" height="4" rx="1.5" />
      <rect x="2" y="11" width="6" height="5" rx="1.5" />
      <rect x="10" y="8" width="6" height="8" rx="1.5" />
    </svg>
  );
}
function IcMarket() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 14 L6 9 L9 11 L14 4 L16 6" />
      <circle cx="14" cy="4" r="1.2" fill="currentColor" />
    </svg>
  );
}
function IcAgents() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="13" cy="6" r="2.5" />
      <circle cx="9.5" cy="13" r="2.5" />
      <path d="M7.5 7.5 L12 11 M11 7.5 L8 11" />
    </svg>
  );
}
function IcChart() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 16 V2 M2 16 H16" />
      <rect x="5" y="9" width="2" height="5" />
      <rect x="9" y="6" width="2" height="8" />
      <rect x="13" y="11" width="2" height="3" />
    </svg>
  );
}
function IcConfig() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="9" cy="9" r="2.5" />
      <path d="M9 1.5 V3.5 M9 14.5 V16.5 M1.5 9 H3.5 M14.5 9 H16.5 M3.6 3.6 L5 5 M13 13 L14.4 14.4 M3.6 14.4 L5 13 M13 5 L14.4 3.6" />
    </svg>
  );
}

const wsColors: Record<WsStatus, string> = {
  connecting: 'var(--warn)',
  connected: 'var(--accent)',
  disconnected: 'var(--ink-4)',
  error: 'var(--danger)',
};

interface SidebarProps {
  page: Page;
  setPage: (page: Page) => void;
  wsStatus: WsStatus;
}

export function Sidebar({ page, setPage, wsStatus }: SidebarProps) {
  const { agents, signals } = useSignalsStore();
  const { config } = useConfigStore();

  // Real watchlist from config, with signal data for daily change
  const watchlistItems = useMemo(() => {
    const tickers = (config.watchlist || '').split(',').map((t: string) => t.trim()).filter(Boolean);
    if (tickers.length === 0) return [];
    return tickers.map((ticker: string) => {
      const sig = signals.find((s) => s.ticker === ticker);
      const debateScore = sig?.debate_score ?? 0;
      // Use debate score direction as proxy for daily sentiment
      const pct = sig ? (sig.signal === 'BUY' ? Math.abs(debateScore) * 0.5 : sig.signal === 'SELL' ? -Math.abs(debateScore) * 0.5 : 0) : 0;
      return [ticker, pct] as [string, number];
    });
  }, [config.watchlist, signals]);

  return (
    <aside className="sidebar">
      <div className="sb-brand">
        <div className="sb-brand-mark">
          <BrandMark />
        </div>
        <div className="sb-brand-name">
          trade<em>IA</em>
        </div>
      </div>

      <div className="sb-section">Navigation</div>
      <ul className="sb-nav">
        {NAV.map((n) => {
          const Icon = n.icon;
          return (
            <li key={n.id}>
              <button
                className={`sb-link ${page === n.id ? 'active' : ''}`}
                onClick={() => setPage(n.id)}
              >
                <span className="sb-link-icon">
                  <Icon />
                </span>
              <span className="sb-link-text">
                <div className="sb-link-label">{n.label}</div>
                <div className="sb-link-sub">{n.sub}</div>
              </span>
            </button>
          </li>
        );
        })}
      </ul>

      <div className="sb-foot">
        <div className="sb-watchlist-title">
          <span>Watchlist</span>
          <span>Signal</span>
        </div>
        {watchlistItems.length === 0 ? (
          <div style={{ padding: '6px 0', color: 'var(--ink-4)', fontSize: 11 }}>Ajoutez des tickers dans la config</div>
        ) : watchlistItems.map(([s, p]) => (
          <div key={s} className="sb-wl-row">
            <span className="sb-wl-sym">{s}</span>
            <span className={`sb-wl-pct ${p >= 0 ? 'up' : 'down'}`}>
              {p >= 0 ? '+' : ''}
              {p.toFixed(2)}%
            </span>
          </div>
        ))}

        {/* Agents mini status */}
        <div style={{ padding: '10px 8px 0', borderTop: '1px solid var(--rule)', marginTop: 8 }}>
          <div className="sb-watchlist-title" style={{ padding: '4px 0 6px' }}>
            <span>Agents</span>
            <span
              className="mono"
              style={{ color: wsColors[wsStatus], fontSize: 10 }}
            >
              {wsStatus === 'connected' ? 'live' : wsStatus}
            </span>
          </div>
          {Object.entries(agents).map(([name, a]) => (
            <div key={name} className="sb-wl-row" style={{ padding: '3px 0' }}>
              <span className="sb-wl-sym" style={{ textTransform: 'capitalize', fontSize: 10 }}>
                {name}
              </span>
              <span
                className="mono"
                style={{
                  fontSize: 10,
                  color:
                    a.status === 'ok'
                      ? 'var(--accent)'
                      : a.status === 'running'
                      ? 'var(--warn)'
                      : a.status === 'error'
                      ? 'var(--danger)'
                      : 'var(--ink-4)',
                }}
              >
                {a.status === 'ok' ? '✓' : a.status === 'running' ? '⟳' : a.status === 'error' ? '✗' : '·'}
              </span>
            </div>
          ))}
        </div>

        <div style={{ padding: '10px 8px 0', color: 'var(--ink-4)', fontSize: 10 }}>
          v2.4 · démo
        </div>
      </div>
    </aside>
  );
}
