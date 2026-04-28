import { usePortfolioStore } from '../../store/portfolio.store';
import { useSignalsStore } from '../../store/signals.store';
import { useConfigStore } from '../../store/config.store';
import { PauseButton } from '../controls/PauseButton';

const REGIME_COLORS: Record<string, string> = {
  NORMAL: '#00D4AA',
  ELEVATED: '#FFB347',
  CRISIS: '#FF4D6D',
};

interface TopBarProps {
  onMenuToggle: () => void;
}

export function TopBar({ onMenuToggle }: TopBarProps) {
  const { portfolio } = usePortfolioStore();
  const { market } = useSignalsStore();
  const { paused } = useConfigStore();

  const pnlPositive = portfolio.daily_pnl_pct >= 0;
  const regimeColor = REGIME_COLORS[portfolio.risk_regime] || '#8892A4';

  return (
    <header className="h-[52px] bg-bg-surface border-b border-border flex items-center px-4 gap-6 flex-shrink-0">
      {/* Mobile menu toggle */}
      <button
        onClick={onMenuToggle}
        className="md:hidden p-1 text-text-secondary hover:text-text-primary"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Portfolio value */}
      <div className="flex items-center gap-3">
        <div>
          <div className="text-[10px] text-text-secondary uppercase tracking-wider">Portfolio</div>
          <div className="font-syne font-bold text-base text-text-primary font-mono-data">
            ${portfolio.total_usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>

        <div className={`text-sm font-mono-data font-medium ${pnlPositive ? 'text-accent-green' : 'text-accent-red'}`}>
          {pnlPositive ? '+' : ''}{portfolio.daily_pnl_pct.toFixed(2)}%
        </div>
      </div>

      <div className="h-6 w-px bg-border" />

      {/* Risk regime */}
      <div className="flex items-center gap-2">
        <div className="text-[10px] text-text-secondary uppercase tracking-wider">Risk</div>
        <span
          className="text-xs font-mono font-bold px-2 py-0.5 rounded"
          style={{
            color: regimeColor,
            background: `${regimeColor}18`,
            border: `1px solid ${regimeColor}40`,
          }}
        >
          {portfolio.risk_regime}
        </span>
      </div>

      {/* VIX */}
      <div className="flex items-center gap-2 hidden sm:flex">
        <div className="text-[10px] text-text-secondary uppercase tracking-wider">VIX</div>
        <span className={`text-sm font-mono-data font-medium ${market.vix > 25 ? 'text-accent-red' : market.vix > 18 ? 'text-accent-amber' : 'text-accent-green'}`}>
          {market.vix.toFixed(1)}
        </span>
      </div>

      {/* Cash */}
      <div className="hidden lg:flex items-center gap-2">
        <div className="text-[10px] text-text-secondary uppercase tracking-wider">Cash</div>
        <span className="text-sm font-mono-data text-text-primary">
          ${portfolio.cash_usd.toLocaleString('en-US', { maximumFractionDigits: 0 })}
        </span>
      </div>

      {/* Positions count */}
      <div className="hidden lg:flex items-center gap-2">
        <div className="text-[10px] text-text-secondary uppercase tracking-wider">Positions</div>
        <span className="text-sm font-mono-data text-text-primary">{portfolio.positions.length}</span>
      </div>

      <div className="ml-auto flex items-center gap-3">
        {paused && (
          <span className="text-xs font-mono text-accent-amber bg-accent-amber/10 border border-accent-amber/30 px-2 py-0.5 rounded animate-pulse">
            ⏸ PAUSED
          </span>
        )}
        <PauseButton />
      </div>
    </header>
  );
}
