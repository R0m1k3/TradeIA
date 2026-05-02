import { usePortfolioStore } from '../../store/portfolio.store';
import { useSignalsStore } from '../../store/signals.store';

export function TopBar({ paused, onToggleRun }: { paused: boolean; onToggleRun: () => void }) {
  const { portfolio } = usePortfolioStore();
  const { market } = useSignalsStore();

  const pnlPositive = portfolio.daily_pnl_pct >= 0;

  return (
    <header className="topbar">
      <div className="tb-stat">
        <div className="tb-stat-label">NAV</div>
        <div className="tb-stat-value">
          ${portfolio.total_usd.toLocaleString('en-US', { minimumFractionDigits: 2 })}
        </div>
      </div>
      <div className="tb-stat">
        <div className="tb-stat-label">P&L jour</div>
        <div
          className="tb-stat-value"
          style={{ color: pnlPositive ? 'var(--accent)' : 'var(--danger)' }}
        >
          {pnlPositive ? '+' : ''}
          {portfolio.daily_pnl_pct.toFixed(2)}%
        </div>
      </div>
      <div className="tb-stat">
        <div className="tb-stat-label">Risque</div>
        <div className="tb-stat-value">{portfolio.risk_regime}</div>
      </div>
      <div className="tb-stat">
        <div className="tb-stat-label">Positions</div>
        <div className="tb-stat-value">{portfolio.positions.length}</div>
      </div>
      <div className="tb-stat">
        <div className="tb-stat-label">Cash</div>
        <div className="tb-stat-value">
          ${portfolio.cash_usd.toLocaleString('en-US', { maximumFractionDigits: 0 })}
        </div>
      </div>
      <div className="tb-spacer" />
      <span className="tb-pill">
        <span className="dot" />
        Marché ouvert · {new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} UTC
      </span>
      <button
        className={`btn ${paused ? 'btn-primary' : 'btn-ghost'} btn-sm`}
        onClick={onToggleRun}
      >
        {paused ? (
          <>
            <svg viewBox="0 0 18 18" fill="currentColor" style={{ width: 14, height: 14 }}>
              <path d="M5 3 L14 9 L5 15 Z" />
            </svg>
            Démarrer
          </>
        ) : (
          <>
            <svg viewBox="0 0 18 18" fill="currentColor" style={{ width: 14, height: 14 }}>
              <rect x="5" y="3" width="3" height="12" rx="1" />
              <rect x="10" y="3" width="3" height="12" rx="1" />
            </svg>
            Pause
          </>
        )}
      </button>
    </header>
  );
}
