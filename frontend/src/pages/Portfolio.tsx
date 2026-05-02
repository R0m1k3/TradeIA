import { useState } from 'react';
import { usePortfolioStore } from '../store/portfolio.store';
import { useSignalsStore } from '../store/signals.store';
import { PortfolioChart } from '../components/charts/PortfolioChart';
import { getTickerName } from '../data/tickerNames';
import type { Trade } from '../types';

function Help({ tip }: { tip: string }) {
  return <span className="card-h-help" data-tip={tip}>i</span>;
}

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

  const currentGain = position.currentPrice - position.entryPrice;
  const trailingStatus = riskAmount > 0 ? (
    currentGain >= 2 * riskAmount ? 'Profit verrouillé (+1R)' :
    currentGain >= riskAmount ? 'Stop au break-even' :
    'Stop initial'
  ) : null;

  return (
    <div className="card" style={{ borderLeft: `3px solid ${pnlPositive ? 'var(--accent)' : 'var(--danger)'}` }}>
      <div
        style={{ padding: 16, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="mono" style={{ fontSize: 15, fontWeight: 600 }}>{position.ticker}</span>
              <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{getTickerName(position.ticker)}</span>
            </div>
            <p style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>
              {position.quantity.toFixed(4)} actions @ ${position.entryPrice.toFixed(2)}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <div style={{ textAlign: 'right' }}>
            <p className="label" style={{ marginBottom: 2 }}>P&L</p>
            <p className={`mono ${pnlPositive ? 'up' : 'down'}`} style={{ fontWeight: 600, fontSize: 14 }}>
              {pnlPositive ? '+' : ''}${position.pnlUsd.toFixed(2)}
            </p>
            <p className={`mono ${pnlPositive ? 'up' : 'down'}`} style={{ fontSize: 11 }}>
              {pnlPositive ? '+' : ''}{position.pnlPct.toFixed(2)}%
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p className="label" style={{ marginBottom: 2 }}>Prix actuel</p>
            <p className="mono" style={{ fontSize: 14 }}>${position.currentPrice.toFixed(2)}</p>
          </div>
          <span style={{ color: 'var(--ink-4)', fontSize: 14, transition: 'transform 0.2s', transform: expanded ? 'rotate(180deg)' : 'none' }}>▾</span>
        </div>
      </div>

      {expanded && (
        <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--rule)' }}>
          {/* Progression Stop/TP */}
          <div style={{ marginTop: 16 }}>
            <p className="label">Progression du trade</p>
            <div style={{ position: 'relative', height: 24, background: 'var(--bg-elev-2)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{
                position: 'absolute', left: 0, top: 0, height: '100%',
                background: 'var(--danger-soft)',
                width: `${(riskAmount / (riskAmount + gainAmount)) * 100}%`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span className="mono" style={{ fontSize: 9, color: 'var(--danger)' }}>Stop ${position.stopLoss.toFixed(0)}</span>
              </div>
              <div style={{
                position: 'absolute', right: 0, top: 0, height: '100%',
                background: 'var(--accent-soft)',
                width: `${(gainAmount / (riskAmount + gainAmount)) * 100}%`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span className="mono" style={{ fontSize: 9, color: 'var(--accent)' }}>TP ${position.takeProfit.toFixed(0)}</span>
              </div>
              {(() => {
                const range = position.takeProfit - position.stopLoss;
                const pos = ((position.currentPrice - position.stopLoss) / range) * 100;
                const clamped = Math.max(2, Math.min(98, pos));
                return <div style={{ position: 'absolute', top: 0, height: '100%', width: 2, background: '#fff', left: `${clamped}%` }} />;
              })()}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>R/R : 1:{rr}</span>
              {trailingStatus && <span className="mono" style={{ fontSize: 10, color: 'var(--warn)' }}>{trailingStatus}</span>}
              <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>Investi : ${position.sizeUsd.toFixed(0)}</span>
            </div>
          </div>

          {/* Raisonnement IA */}
          {signal && (
            <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-elev-2)', borderRadius: 6 }}>
              <p className="label" style={{ marginBottom: 8 }}>Pourquoi ce trade ?</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: 'var(--accent)', fontSize: 14 }}>🟢</span>
                  <div>
                    <p style={{ fontSize: 10, color: 'var(--ink-3)' }}>Camp haussier</p>
                    <p className="mono up" style={{ fontSize: 13, fontWeight: 600 }}>{signal.bull_conviction}/10</p>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: 'var(--danger)', fontSize: 14 }}>🔴</span>
                  <div>
                    <p style={{ fontSize: 10, color: 'var(--ink-3)' }}>Camp baissier</p>
                    <p className="mono down" style={{ fontSize: 13, fontWeight: 600 }}>{signal.bear_conviction}/10</p>
                  </div>
                </div>
              </div>
              {signal.reasoning && (
                <p style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5, borderTop: '1px solid var(--rule)', paddingTop: 8, marginTop: 8 }}>
                  {signal.reasoning}
                </p>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>Confiance IA :</span>
                <div style={{ flex: 1, height: 4, background: 'var(--rule)', borderRadius: 2 }}>
                  <div style={{ height: 4, borderRadius: 2, background: 'var(--accent)', width: `${signal.confidence}%` }} />
                </div>
                <span className="mono" style={{ fontSize: 10, color: 'var(--accent)' }}>{signal.confidence}%</span>
              </div>
            </div>
          )}

          {!signal && (
            <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-elev-2)', borderRadius: 6 }}>
              <p style={{ fontSize: 11, color: 'var(--ink-3)' }}>Raisonnement IA non disponible pour ce cycle (trade d'un cycle précédent).</p>
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
    <tr style={{ borderBottom: '1px solid var(--rule)' }}>
      <td className="mono" style={{ padding: '10px 12px', fontWeight: 600, fontSize: 12 }}>{trade.ticker}</td>
      <td style={{ padding: '10px 12px', fontSize: 11, color: 'var(--ink-3)' }}>{getTickerName(trade.ticker)}</td>
      <td className="mono" style={{ padding: '10px 12px', fontSize: 12, color: 'var(--ink-3)' }}>${trade.filledPrice.toFixed(2)}</td>
      <td className="mono" style={{ padding: '10px 12px', fontSize: 12, color: 'var(--ink-3)' }}>${trade.closePrice?.toFixed(2) || '—'}</td>
      <td className="mono" style={{ padding: '10px 12px', fontSize: 12, color: 'var(--ink-3)' }}>{trade.quantity.toFixed(4)}</td>
      <td className="mono" style={{ padding: '10px 12px', fontSize: 12, fontWeight: 600, color: pnlPositive ? 'var(--accent)' : 'var(--danger)' }}>
        {pnlPositive ? '+' : ''}${(trade.pnlUsd || 0).toFixed(2)}
      </td>
      <td style={{ padding: '10px 12px' }}>
        <span
          className="mono"
          title={reasonLabel}
          style={{
            fontSize: 11, padding: '2px 8px', borderRadius: 4,
            color: trade.closeReason === 'TP' ? 'var(--accent)' : trade.closeReason === 'SL' ? 'var(--danger)' : 'var(--warn)',
            background: trade.closeReason === 'TP' ? 'var(--accent-soft)' : trade.closeReason === 'SL' ? 'var(--danger-soft)' : 'var(--warn-soft)',
          }}
        >
          {icon} {reasonLabel}
        </span>
      </td>
      <td style={{ padding: '10px 12px' }}>
        <span className="mono" style={{ fontSize: 11, color: trade.bullConviction > trade.bearConviction ? 'var(--accent)' : 'var(--danger)' }}>
          {trade.bullConviction > trade.bearConviction ? '🟢 Haussier' : '🔴 Baissier'}
        </span>
      </td>
      <td className="mono" style={{ padding: '10px 12px', fontSize: 10, color: 'var(--ink-3)' }}>
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
  const investedUsd = portfolio.positions.reduce((s, p) => s + p.sizeUsd, 0);
  const unrealizedPnl = portfolio.positions.reduce((s, p) => s + p.pnlUsd, 0);

  return (
    <div className="page">
      <div className="flex between center" style={{ marginBottom: 22 }}>
        <div>
          <h1 className="h1">Portefeuille</h1>
          <div style={{ color: 'var(--ink-3)', fontSize: 13, marginTop: 6 }}>
            Suivi des positions, P&L et décisions des agents IA.
          </div>
        </div>
      </div>

      {/* Portfolio value + chart */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <p className="label">Valeur totale</p>
              <p className="mono" style={{ fontSize: 28, fontWeight: 600 }}>
                ${portfolio.total_usd.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </p>
              <p className="mono" style={{ fontSize: 13, color: totalPnlPct >= 0 ? 'var(--accent)' : 'var(--danger)' }}>
                {totalPnlPct >= 0 ? '+' : ''}{totalPnlPct.toFixed(2)}%
                {' '}({totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)})
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p className="label">Régime de risque</p>
              <p style={{
                fontWeight: 600, fontSize: 14,
                color: portfolio.risk_regime === 'NORMAL' ? 'var(--accent)' :
                       portfolio.risk_regime === 'ELEVATED' ? 'var(--warn)' : 'var(--danger)',
              }}>
                {portfolio.risk_regime}
              </p>
            </div>
          </div>
          <PortfolioChart history={history} startingValue={startingValue} />
        </div>
      </div>

      {/* Summary cards */}
      {portfolio.positions.length > 0 && (
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div className="card">
            <div style={{ padding: 16, textAlign: 'center' }}>
              <p className="label">Capital investi</p>
              <p className="mono" style={{ fontSize: 18, fontWeight: 600 }}>${investedUsd.toFixed(0)}</p>
              <p className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                {((investedUsd / portfolio.total_usd) * 100).toFixed(1)}% du portefeuille
              </p>
            </div>
          </div>
          <div className="card">
            <div style={{ padding: 16, textAlign: 'center' }}>
              <p className="label">P&L non-réalisé</p>
              <p className="mono" style={{ fontSize: 18, fontWeight: 600, color: unrealizedPnl >= 0 ? 'var(--accent)' : 'var(--danger)' }}>
                {unrealizedPnl >= 0 ? '+' : ''}${unrealizedPnl.toFixed(2)}
              </p>
            </div>
          </div>
          <div className="card">
            <div style={{ padding: 16, textAlign: 'center' }}>
              <p className="label">Liquidités dispo</p>
              <p className="mono" style={{ fontSize: 18, fontWeight: 600 }}>${portfolio.cash_usd.toFixed(0)}</p>
              <p style={{ fontSize: 11, color: 'var(--ink-3)' }}>pour de nouveaux trades</p>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--rule)', marginBottom: 12 }}>
        {(['open', 'history'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '8px 16px', fontSize: 12, fontFamily: 'var(--mono)',
              border: 'none', background: 'none', cursor: 'pointer',
              borderBottom: t === tab ? '2px solid var(--accent)' : '2px solid transparent',
              color: t === tab ? 'var(--ink)' : 'var(--ink-3)',
              fontWeight: t === tab ? 600 : 400,
            }}
          >
            {t === 'open' ? `Ouvertes (${portfolio.positions.length})` : `Historique (${history.length})`}
          </button>
        ))}
      </div>

      {/* Open positions */}
      {tab === 'open' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {portfolio.positions.length === 0 ? (
            <div className="card">
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
                Aucune position ouverte — le système IA attend les prochaines opportunités
              </div>
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
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--rule)' }}>
                  {['Ticker', 'Entreprise', 'Entrée', 'Sortie', 'Qté', 'P&L', 'Résultat', 'Camp gagnant', 'Date'].map((h) => (
                    <th key={h} style={{
                      textAlign: 'left', padding: '8px 12px', fontSize: 10,
                      color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em',
                      fontWeight: 400,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ padding: 32, textAlign: 'center', color: 'var(--ink-3)' }}>
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