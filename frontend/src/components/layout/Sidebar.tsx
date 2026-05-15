import { useSignalsStore } from '../../store/signals.store';
import type { Page } from '../../App';
import type { WsStatus } from '../../hooks/useWebSocket';

const NAV = [
  { id: 'dashboard' as Page, label: 'Tableau de bord', sub: 'Portefeuille & P&L', icon: IcDash },
  { id: 'markets' as Page, label: 'Vue Marché', sub: 'Synthèse temps réel', icon: IcMarket },
  { id: 'watchlist' as Page, label: 'Watchlist', sub: 'NASDAQ · CAC · DAX · FTSE', icon: IcWatchlist },
  { id: 'research' as Page, label: 'Recherche', sub: 'Historique & notes', icon: IcResearch },
  { id: 'agents' as Page, label: 'Décisions LLM', sub: 'Pipeline & choix IA', icon: IcAgents },
  { id: 'portfolio' as Page, label: 'Portefeuille', sub: 'Positions & ordres', icon: IcChart },
  { id: 'config' as Page, label: 'Configuration', sub: 'Stratégie & système', icon: IcConfig },
];

/**
 * Pipeline réel: 5 étapes. Une seule (Décideur) appelle le LLM.
 * Les clés mappent les `agents` du store (mis à jour par l'orchestrator).
 */
const PIPELINE_STAGES: Array<{ key: string; label: string; isLLM: boolean }> = [
  { key: 'collector', label: 'Collecteur', isLLM: false },
  { key: 'analyst', label: 'Analyste', isLLM: false },
  { key: 'strategist', label: 'Décideur', isLLM: true },
  { key: 'risk', label: 'Risk', isLLM: false },
  { key: 'reporter', label: 'Broker', isLLM: false },
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
function IcWatchlist() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="2" width="14" height="3" rx="1" />
      <rect x="2" y="7.5" width="14" height="3" rx="1" />
      <rect x="2" y="13" width="14" height="3" rx="1" />
    </svg>
  );
}
function IcAgents() {
  // Pipeline icon: data flowing through stages with a spark on the LLM step
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="3" cy="9" r="1.5" />
      <path d="M4.5 9 H7" />
      <rect x="7" y="6" width="4" height="6" rx="1" />
      <path d="M11 9 H13.5" />
      <circle cx="15" cy="9" r="1.5" />
      <path d="M9 4 L9.7 5.4 L11 5.6 L10 6.6 L10.3 8 L9 7.3 L7.7 8 L8 6.6 L7 5.6 L8.3 5.4 Z" fill="currentColor" stroke="none" opacity="0.65" />
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
function IcResearch() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="5" />
      <path d="M12 12 L16 16" />
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
  const { agents } = useSignalsStore();

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
        {/* Pipeline mini status — 5 stages, only one is LLM */}
        <div style={{ padding: '10px 8px 0', borderTop: '1px solid var(--rule)', marginTop: 8 }}>
          <div className="sb-watchlist-title" style={{ padding: '4px 0 6px' }}>
            <span>Pipeline</span>
            <span
              className="mono"
              style={{ color: wsColors[wsStatus], fontSize: 10 }}
            >
              {wsStatus === 'connected' ? 'live' : wsStatus}
            </span>
          </div>
          {PIPELINE_STAGES.map((stage) => {
            const a = (agents as any)[stage.key] ?? { status: 'idle' };
            const statusColor =
              a.status === 'ok' ? 'var(--accent)'
              : a.status === 'running' ? 'var(--warn)'
              : a.status === 'error' ? 'var(--danger)'
              : 'var(--ink-4)';
            const statusIcon =
              a.status === 'ok' ? '✓'
              : a.status === 'running' ? '⟳'
              : a.status === 'error' ? '✗'
              : '·';
            return (
              <div key={stage.key} className="sb-wl-row" style={{ padding: '3px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10 }}>
                  <span className="sb-wl-sym">{stage.label}</span>
                  {stage.isLLM && (
                    <span style={{
                      fontSize: 8,
                      padding: '1px 4px',
                      borderRadius: 3,
                      background: 'oklch(0.74 0.10 280 / 0.2)',
                      color: 'oklch(0.74 0.10 280)',
                      fontFamily: 'var(--mono)',
                      fontWeight: 600,
                      letterSpacing: 0.3,
                    }}>LLM</span>
                  )}
                </span>
                <span className="mono" style={{ fontSize: 10, color: statusColor }}>
                  {statusIcon}
                </span>
              </div>
            );
          })}
        </div>

        <div style={{ padding: '10px 8px 0', color: 'var(--ink-4)', fontSize: 10 }}>
          v2.5 · démo
        </div>
      </div>
    </aside>
  );
}
