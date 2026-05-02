import { useState } from 'react';
import { usePortfolioStore } from '../store/portfolio.store';
import { PortfolioChart } from '../components/charts/PortfolioChart';
import { getTickerName } from '../data/tickerNames';
import type { Trade } from '../types';

const CLOSE_REASON_ICONS: Record<string, string> = {
  TP: '✓',
  SL: '✗',
  MANUAL: '⊘',
  STRUCTURE_BREAK: '⊗',
};

function PositionRow({ position }: { position: { ticker: string; quantity: number; entryPrice: number; currentPrice: number; sizeUsd: number; pnlUsd: number; pnlPct: number; stopLoss: number; takeProfit: number } }) {
  const pnlPositive = position.pnlUsd >= 0;

  return (
    <tr className="border-b border-border/50 hover:bg-bg-elevated transition-colors">
      <td className="px-4 py-3 font-mono font-bold text-text-primary">{position.ticker}</td>
      <td className="px-4 py-3 text-text-secondary text-[11px]">{getTickerName(position.ticker)}</td>
      <td className="px-4 py-3 font-mono text-text-secondary">${position.entryPrice.toFixed(2)}</td>
      <td className="px-4 py-3 font-mono text-text-primary">${position.currentPrice.toFixed(2)}</td>
      <td className="px-4 py-3 font-mono text-text-secondary">{position.quantity.toFixed(4)}</td>
      <td className="px-4 py-3 font-mono font-bold" style={{ color: pnlPositive ? '#00D4AA' : '#FF4D6D' }}>
        {pnlPositive ? '+' : ''}${position.pnlUsd.toFixed(2)}
      </td>
      <td className="px-4 py-3 font-mono font-bold" style={{ color: pnlPositive ? '#00D4AA' : '#FF4D6D' }}>
        {pnlPositive ? '+' : ''}{position.pnlPct.toFixed(2)}%
      </td>
      <td className="px-4 py-3 font-mono text-accent-red">${position.stopLoss.toFixed(2)}</td>
      <td className="px-4 py-3 font-mono text-accent-green">${position.takeProfit.toFixed(2)}</td>
    </tr>
  );
}

function TradeRow({ trade }: { trade: Trade }) {
  const pnlPositive = (trade.pnlUsd || 0) >= 0;
  const icon = trade.closeReason ? CLOSE_REASON_ICONS[trade.closeReason] || '?' : '?';

  return (
    <tr className="border-b border-border/50 hover:bg-bg-elevated transition-colors">
      <td className="px-4 py-3 font-mono font-bold text-text-primary">{trade.ticker}</td>
      <td className="px-4 py-3 text-text-secondary text-[11px]">{getTickerName(trade.ticker)}</td>
      <td className="px-4 py-3 font-mono text-text-secondary">${trade.filledPrice.toFixed(2)}</td>
      <td className="px-4 py-3 font-mono text-text-secondary">${trade.closePrice?.toFixed(2) || '—'}</td>
      <td className="px-4 py-3 font-mono text-text-secondary">{trade.quantity.toFixed(4)}</td>
      <td className="px-4 py-3 font-mono font-bold" style={{ color: pnlPositive ? '#00D4AA' : '#FF4D6D' }}>
        {pnlPositive ? '+' : ''}${(trade.pnlUsd || 0).toFixed(2)}
      </td>
      <td className="px-4 py-3">
        <span
          className="text-xs font-mono px-2 py-0.5 rounded"
          style={{
            color: trade.closeReason === 'TP' ? '#00D4AA' : trade.closeReason === 'SL' ? '#FF4D6D' : '#FFB347',
            background: trade.closeReason === 'TP' ? '#00D4AA15' : trade.closeReason === 'SL' ? '#FF4D6D15' : '#FFB34715',
          }}
        >
          {icon} {trade.closeReason}
        </span>
      </td>
      <td className="px-4 py-3">
        <span
          className="text-[10px] font-mono"
          style={{ color: trade.bullConviction > trade.bearConviction ? '#00D4AA' : '#FF4D6D' }}
        >
          {trade.bullConviction > trade.bearConviction ? 'Haussier ✓' : 'Baissier ✓'}
        </span>
      </td>
      <td className="px-4 py-3 text-[10px] text-text-secondary font-mono">
        {trade.closedAt ? new Date(trade.closedAt).toLocaleDateString('fr-FR') : '—'}
      </td>
    </tr>
  );
}

export function Portfolio() {
  const { portfolio, history } = usePortfolioStore();
  const [tab, setTab] = useState<'open' | 'history'>('open');

  const startingValue = portfolio.initial_capital || 10000;
  const totalPnl = portfolio.total_usd - startingValue;
  const totalPnlPct = (totalPnl / startingValue) * 100;

  return (
    <div className="space-y-4 max-w-[1600px]">
      {/* Portfolio curve */}
      <div className="bg-bg-surface rounded-lg border border-border p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-syne font-bold text-lg text-text-primary">
              ${portfolio.total_usd.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </h2>
            <p
              className="text-sm font-mono"
              style={{ color: totalPnlPct >= 0 ? '#00D4AA' : '#FF4D6D' }}
            >
              {totalPnlPct >= 0 ? '+' : ''}{totalPnlPct.toFixed(2)}% total
              {' '}({totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)})
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-text-secondary uppercase tracking-wider">Positions</p>
            <p className="font-syne font-bold text-text-primary">{portfolio.positions.length}</p>
          </div>
        </div>
        <PortfolioChart history={history} startingValue={startingValue} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(['open', 'history'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-mono transition-colors border-b-2 -mb-px ${
              tab === t
                ? 'border-accent-green text-text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {t === 'open' ? `Ouvertes (${portfolio.positions.length})` : `Historique (${history.length})`}
          </button>
        ))}
      </div>

      {/* Open positions */}
      {tab === 'open' && (
        <div className="bg-bg-surface rounded-lg border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  {['Ticker', 'Entreprise', 'Entrée', 'Actuel', 'Qté', 'P&L $', 'P&L %', 'Stop', 'TP'].map((h) => (
                    <th key={h} className="text-left px-4 py-2 text-[10px] text-text-secondary uppercase tracking-wider font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {portfolio.positions.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-text-secondary">
                      Aucune position ouverte
                    </td>
                  </tr>
                ) : (
                  portfolio.positions.map((p) => <PositionRow key={p.ticker} position={p} />)
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Trade history */}
      {tab === 'history' && (
        <div className="bg-bg-surface rounded-lg border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  {['Ticker', 'Entreprise', 'Entrée', 'Sortie', 'Qté', 'P&L', 'Résultat', 'Gagnant', 'Date'].map((h) => (
                    <th key={h} className="text-left px-4 py-2 text-[10px] text-text-secondary uppercase tracking-wider font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-text-secondary">
                      Aucun trade fermé
                    </td>
                  </tr>
                ) : (
                  history.map((t) => <TradeRow key={t.id} trade={t} />)
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}