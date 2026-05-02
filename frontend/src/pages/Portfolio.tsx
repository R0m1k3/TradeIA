import { useState } from 'react';
import { usePortfolioStore } from '../store/portfolio.store';
import { useSignalsStore } from '../store/signals.store';
import { PortfolioChart } from '../components/charts/PortfolioChart';
import { getTickerName } from '../data/tickerNames';
import type { Trade } from '../types';

const CLOSE_REASON_ICONS: Record<string, string> = {
  TP: '✓',
  SL: '✗',
  MANUAL: '⊘',
  STRUCTURE_BREAK: '⊗',
  CIRCUIT_BREAKER: '🚨',
};

const CLOSE_REASON_LABELS: Record<string, string> = {
  TP: 'Objectif atteint',
  SL: 'Stop-loss déclenché',
  MANUAL: 'Fermeture manuelle',
  CIRCUIT_BREAKER: 'Circuit breaker',
};

function PositionCard({ position, signal }: {
  position: {
    ticker: string;
    quantity: number;
    entryPrice: number;
    currentPrice: number;
    sizeUsd: number;
    pnlUsd: number;
    pnlPct: number;
    stopLoss: number;
    takeProfit: number;
  };
  signal?: { debate_score: number; bull_conviction: number; bear_conviction: number; confidence: number; reasoning: string } | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const pnlPositive = position.pnlUsd >= 0;
  const riskAmount = position.entryPrice - position.stopLoss;
  const gainAmount = position.takeProfit - position.entryPrice;
  const rr = riskAmount > 0 ? (gainAmount / riskAmount).toFixed(1) : '—';

  // Calcul progression trailing stop
  const currentGain = position.currentPrice - position.entryPrice;
  const trailingStatus = riskAmount > 0 ? (
    currentGain >= 2 * riskAmount ? 'Profit verrouillé (+1R)' :
    currentGain >= riskAmount ? 'Stop au break-even' :
    'Stop initial'
  ) : null;

  return (
    <div className={`bg-bg-surface rounded-lg border transition-all ${pnlPositive ? 'border-accent-green/20' : 'border-accent-red/20'}`}>
      {/* Header */}
      <div
        className="p-4 cursor-pointer flex items-center justify-between"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <div className={`w-1 h-12 rounded-full ${pnlPositive ? 'bg-accent-green' : 'bg-accent-red'}`} />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-syne font-bold text-text-primary">{position.ticker}</span>
              <span className="text-[10px] text-text-secondary">{getTickerName(position.ticker)}</span>
            </div>
            <p className="text-xs text-text-secondary mt-0.5">
              {position.quantity.toFixed(4)} actions @ ${position.entryPrice.toFixed(2)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="text-[10px] text-text-secondary uppercase">P&L</p>
            <p className={`font-mono font-bold ${pnlPositive ? 'text-accent-green' : 'text-accent-red'}`}>
              {pnlPositive ? '+' : ''}${position.pnlUsd.toFixed(2)}
            </p>
            <p className={`text-[10px] font-mono ${pnlPositive ? 'text-accent-green' : 'text-accent-red'}`}>
              {pnlPositive ? '+' : ''}{position.pnlPct.toFixed(2)}%
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-text-secondary uppercase">Prix actuel</p>
            <p className="font-mono text-text-primary">${position.currentPrice.toFixed(2)}</p>
          </div>
          <span className={`text-text-secondary text-sm transition-transform ${expanded ? 'rotate-180' : ''}`}>▾</span>
        </div>
      </div>

      {/* Expanded "Pourquoi ce trade?" */}
      {expanded && (
        <div className="border-t border-border p-4 space-y-4">
          {/* Barres Stop/TP visuelles */}
          <div>
            <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-2">Progression du trade</p>
            <div className="relative h-6 bg-bg-elevated rounded overflow-hidden">
              {/* Zone rouge (stop) */}
              <div className="absolute left-0 top-0 h-full bg-accent-red/20 flex items-center justify-center"
                style={{ width: `${(riskAmount / (riskAmount + gainAmount)) * 100}%` }}>
                <span className="text-[8px] text-accent-red font-mono">Stop ${position.stopLoss.toFixed(0)}</span>
              </div>
              {/* Zone verte (TP) */}
              <div className="absolute right-0 top-0 h-full bg-accent-green/20 flex items-center justify-center"
                style={{ width: `${(gainAmount / (riskAmount + gainAmount)) * 100}%` }}>
                <span className="text-[8px] text-accent-green font-mono">TP ${position.takeProfit.toFixed(0)}</span>
              </div>
              {/* Curseur prix actuel */}
              {(() => {
                const range = position.takeProfit - position.stopLoss;
                const pos = ((position.currentPrice - position.stopLoss) / range) * 100;
                const clamped = Math.max(2, Math.min(98, pos));
                return (
                  <div
                    className="absolute top-0 h-full w-0.5 bg-white"
                    style={{ left: `${clamped}%` }}
                  />
                );
              })()}
            </div>
            <div className="flex justify-between text-[9px] text-text-secondary mt-1">
              <span>R/R : 1:{rr}</span>
              {trailingStatus && <span className="text-accent-amber">{trailingStatus}</span>}
              <span>Investi : ${position.sizeUsd.toFixed(0)}</span>
            </div>
          </div>

          {/* Raison IA */}
          {signal && (
            <div className="bg-bg-elevated rounded p-3">
              <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-2">Pourquoi ce trade ?</p>
              <div className="grid grid-cols-2 gap-3 mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-accent-green text-sm">🟢</span>
                  <div>
                    <p className="text-[9px] text-text-secondary">Camp haussier</p>
                    <p className="text-xs text-accent-green font-mono font-bold">{signal.bull_conviction}/10</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-accent-red text-sm">🔴</span>
                  <div>
                    <p className="text-[9px] text-text-secondary">Camp baissier</p>
                    <p className="text-xs text-accent-red font-mono font-bold">{signal.bear_conviction}/10</p>
                  </div>
                </div>
              </div>
              {signal.reasoning && (
                <p className="text-[11px] text-text-primary leading-relaxed border-t border-border pt-2 mt-2">
                  {signal.reasoning}
                </p>
              )}
              <div className="flex items-center gap-2 mt-2">
                <span className="text-[9px] text-text-secondary">Confiance IA :</span>
                <div className="flex-1 h-1 bg-border rounded-full">
                  <div className="h-1 rounded-full bg-accent-blue" style={{ width: `${signal.confidence}%` }} />
                </div>
                <span className="text-[9px] font-mono text-accent-blue">{signal.confidence}%</span>
              </div>
            </div>
          )}

          {!signal && (
            <div className="bg-bg-elevated rounded p-3">
              <p className="text-[10px] text-text-secondary">Raisonnement IA non disponible pour ce cycle (trade d'un cycle précédent).</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TradeRow({ trade }: { trade: Trade }) {
  const pnlPositive = (trade.pnlUsd || 0) >= 0;
  const icon = trade.closeReason ? CLOSE_REASON_ICONS[trade.closeReason] || '?' : '?';
  const reasonLabel = trade.closeReason ? CLOSE_REASON_LABELS[trade.closeReason] || trade.closeReason : '?';

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
          title={reasonLabel}
          style={{
            color: trade.closeReason === 'TP' ? '#00D4AA' : trade.closeReason === 'SL' ? '#FF4D6D' : '#FFB347',
            background: trade.closeReason === 'TP' ? '#00D4AA15' : trade.closeReason === 'SL' ? '#FF4D6D15' : '#FFB34715',
          }}
        >
          {icon} {reasonLabel}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className="text-[10px] font-mono" style={{ color: trade.bullConviction > trade.bearConviction ? '#00D4AA' : '#FF4D6D' }}>
          {trade.bullConviction > trade.bearConviction ? '🟢 Haussier' : '🔴 Baissier'}
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
  const { signals } = useSignalsStore();
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
            <p className="text-sm font-mono" style={{ color: totalPnlPct >= 0 ? '#00D4AA' : '#FF4D6D' }}>
              {totalPnlPct >= 0 ? '+' : ''}{totalPnlPct.toFixed(2)}% total
              {' '}({totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)})
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-text-secondary uppercase tracking-wider">Régime</p>
            <p className={`font-syne font-bold text-sm ${
              portfolio.risk_regime === 'NORMAL' ? 'text-accent-green' :
              portfolio.risk_regime === 'ELEVATED' ? 'text-accent-amber' : 'text-accent-red'
            }`}>{portfolio.risk_regime}</p>
          </div>
        </div>
        <PortfolioChart history={history} startingValue={startingValue} />
      </div>

      {/* Résumé risque */}
      {portfolio.positions.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-bg-surface rounded-lg border border-border p-3 text-center">
            <p className="text-[10px] text-text-secondary uppercase tracking-wider">Capital investi</p>
            <p className="font-mono font-bold text-text-primary">
              ${portfolio.positions.reduce((s, p) => s + p.sizeUsd, 0).toFixed(0)}
            </p>
            <p className="text-[9px] text-text-secondary">
              {((portfolio.positions.reduce((s, p) => s + p.sizeUsd, 0) / portfolio.total_usd) * 100).toFixed(1)}% du portefeuille
            </p>
          </div>
          <div className="bg-bg-surface rounded-lg border border-border p-3 text-center">
            <p className="text-[10px] text-text-secondary uppercase tracking-wider">P&L non-réalisé</p>
            <p className={`font-mono font-bold ${portfolio.positions.reduce((s, p) => s + p.pnlUsd, 0) >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
              {portfolio.positions.reduce((s, p) => s + p.pnlUsd, 0) >= 0 ? '+' : ''}
              ${portfolio.positions.reduce((s, p) => s + p.pnlUsd, 0).toFixed(2)}
            </p>
          </div>
          <div className="bg-bg-surface rounded-lg border border-border p-3 text-center">
            <p className="text-[10px] text-text-secondary uppercase tracking-wider">Liquidités dispo</p>
            <p className="font-mono font-bold text-text-primary">${portfolio.cash_usd.toFixed(0)}</p>
            <p className="text-[9px] text-text-secondary">pour de nouveaux trades</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(['open', 'history'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-mono transition-colors border-b-2 -mb-px ${
              tab === t ? 'border-accent-green text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {t === 'open' ? `Ouvertes (${portfolio.positions.length})` : `Historique (${history.length})`}
          </button>
        ))}
      </div>

      {/* Open positions — cartes expansibles */}
      {tab === 'open' && (
        <div className="space-y-3">
          {portfolio.positions.length === 0 ? (
            <div className="bg-bg-surface rounded-lg border border-border p-8 text-center text-text-secondary">
              Aucune position ouverte — le système IA attend les prochaines opportunités
            </div>
          ) : (
            portfolio.positions.map((p) => {
              const signal = signals.find((s) => s.ticker === p.ticker) || null;
              return <PositionCard key={p.ticker} position={p} signal={signal} />;
            })
          )}
        </div>
      )}

      {/* Trade history */}
      {tab === 'history' && (
        <div className="bg-bg-surface rounded-lg border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  {['Ticker', 'Entreprise', 'Entrée', 'Sortie', 'Qté', 'P&L', 'Résultat', 'Camp gagnant', 'Date'].map((h) => (
                    <th key={h} className="text-left px-4 py-2 text-[10px] text-text-secondary uppercase tracking-wider font-normal">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-text-secondary">Aucun trade fermé</td>
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
