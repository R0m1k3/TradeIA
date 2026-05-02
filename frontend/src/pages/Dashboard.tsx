import { useState, useMemo } from 'react';
import { usePortfolioStore } from '../store/portfolio.store';
import { useSignalsStore } from '../store/signals.store';
import { useConfigStore } from '../store/config.store';
import type { Page } from '../App';
import { getTickerName } from '../data/tickerNames';

const SIGNAL_COLOR: Record<string, string> = {
  BUY: 'var(--accent)',
  SELL: 'var(--danger)',
  HOLD: 'var(--warn)',
};
const SIGNAL_LABEL: Record<string, string> = {
  BUY: 'ACHAT',
  SELL: 'VENTE',
  HOLD: 'CONSERVE',
};

function Help({ tip }: { tip: string }) {
  return <span className="card-h-help" data-tip={tip}>i</span>;
}

function Sparkline({ data, color = 'var(--accent)', w = 120, h = 32, fill = false }: { data: number[]; color?: string; w?: number; h?: number; fill?: boolean }) {
  if (data.length < 2) return <svg width={w} height={h} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const r = max - min || 1;
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => `${i * step},${h - ((v - min) / r) * (h - 4) - 2}`).join(' ');
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      {fill && <polyline points={`0,${h} ${pts} ${w},${h}`} fill={color} opacity="0.15" stroke="none" />}
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

interface DashboardProps {
  onNavigate: (page: Page) => void;
}

export function Dashboard({ onNavigate }: DashboardProps) {
  const { portfolio, history } = usePortfolioStore();
  const { signals, market, lastUpdate } = useSignalsStore();
  const { config } = useConfigStore();
  const [tab, setTab] = useState<'open' | 'hist'>('open');

  const nav = portfolio.total_usd;
  const pnl = portfolio.daily_pnl_pct;
  const positions = portfolio.positions;

  const startingValue = portfolio.initial_capital || 10000;
  const totalPnl = nav - startingValue;
  const totalPnlPct = startingValue > 0 ? (totalPnl / startingValue) * 100 : 0;

  // Build curve from real trade history
  const curve = useMemo(() => {
    if (history.length === 0) return [startingValue];
    const sorted = [...history]
      .filter((t) => t.closedAt)
      .sort((a, b) => new Date(a.closedAt!).getTime() - new Date(b.closedAt!).getTime());
    let v = startingValue;
    const out = [v];
    for (const t of sorted) {
      v += t.pnlUsd || 0;
      out.push(v);
    }
    return out;
  }, [history, startingValue]);

  // Real allocation from open positions
  const allocation = useMemo(() => {
    if (positions.length === 0) return [{ label: 'Cash', pct: 100, color: 'var(--ink-4)' }];
    const byAsset: Record<string, number> = {};
    for (const p of positions) {
      byAsset[p.ticker] = (byAsset[p.ticker] || 0) + p.sizeUsd;
    }
    const invested = positions.reduce((s, p) => s + p.sizeUsd, 0);
    const cashPct = nav > 0 ? Math.max(0, (portfolio.cash_usd / nav) * 100) : 0;
    const items = Object.entries(byAsset).map(([ticker, usd]) => ({
      label: ticker,
      pct: nav > 0 ? (usd / nav) * 100 : 0,
      color: 'var(--accent)',
    }));
    if (cashPct > 0) items.push({ label: 'Cash', pct: cashPct, color: 'var(--ink-4)' });
    return items;
  }, [positions, nav, portfolio.cash_usd]);

  // Real metrics from history
  const metrics = useMemo(() => {
    const closed = history.filter((t) => t.closedAt && t.pnlUsd !== null);
    const wins = closed.filter((t) => (t.pnlUsd || 0) > 0);
    const totalPnlClosed = closed.reduce((s, t) => s + (t.pnlUsd || 0), 0);
    const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;

    // Max drawdown from curve
    let peak = startingValue;
    let maxDD = 0;
    for (const v of curve) {
      if (v > peak) peak = v;
      const dd = peak > 0 ? ((v - peak) / peak) * 100 : 0;
      if (dd < maxDD) maxDD = dd;
    }

    // Trades per month (last 30 days)
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recentTrades = closed.filter((t) => new Date(t.closedAt!).getTime() > thirtyDaysAgo);
    const tradesPerMonth = recentTrades.length;

    return {
      winRate,
      maxDD: maxDD.toFixed(1),
      totalTrades: closed.length,
      tradesPerMonth,
    };
  }, [history, curve, startingValue]);

  const openPositions = positions.map((p) => {
    const sig = signals.find((s) => s.ticker === p.ticker);
    return {
      sym: p.ticker,
      side: 'LONG' as const,
      qty: p.quantity,
      entry: p.entryPrice,
      mark: p.currentPrice,
      pnl: p.pnlUsd,
      pct: p.pnlPct,
      signal: sig?.signal || 'HOLD',
      confidence: sig?.confidence || 0,
      reasoning: sig?.reasoning || '',
    };
  });

  // Time since last update
  const lastUpdateStr = useMemo(() => {
    if (!lastUpdate) return '—';
    const diff = Date.now() - new Date(lastUpdate).getTime();
    if (diff < 5000) return 'à l\'instant';
    if (diff < 60000) return `il y a ${Math.floor(diff / 1000)}s`;
    if (diff < 3600000) return `il y a ${Math.floor(diff / 60000)}min`;
    return `il y a ${Math.floor(diff / 3600000)}h`;
  }, [lastUpdate]);

  return (
    <div className="page">
      <div className="flex between center" style={{ marginBottom: 22 }}>
        <div>
          <h1 className="h1">Tableau de bord</h1>
          <div style={{ color: 'var(--ink-3)', fontSize: 13, marginTop: 6 }}>
            Vue synthétique de votre portefeuille et des positions actives gérées par les agents.
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('portfolio')}>Voir le portefeuille</button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid" style={{ gridTemplateColumns: '1.4fr repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        <div className="card">
          <div className="kpi" style={{ paddingBottom: 0 }}>
            <div className="kpi-label">
              Valeur du portefeuille <Help tip="Capital total : positions ouvertes + liquidités." />
            </div>
            <div className="kpi-value">${nav.toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
            <div className="kpi-sub" style={{ color: totalPnlPct >= 0 ? 'var(--accent)' : 'var(--danger)' }}>
              {totalPnlPct >= 0 ? '+' : ''}{totalPnlPct.toFixed(2)}% depuis le début · {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(0)}
            </div>
          </div>
          {curve.length > 1 ? (
            <div style={{ padding: '12px 20px 16px' }}>
              <Sparkline data={curve} w={500} h={48} fill={true} color={totalPnl >= 0 ? 'var(--accent)' : 'var(--danger)'} />
            </div>
          ) : (
            <div style={{ padding: '12px 20px 16px', color: 'var(--ink-4)', fontSize: 11 }}>
              Courbe P&L : pas encore de trades fermés
            </div>
          )}
        </div>
        <div className="card kpi">
          <div className="kpi-label">P&L jour <Help tip="Gain ou perte de la journée, basé sur les trades fermés + P&L non-réalisé." /></div>
          <div className="kpi-value" style={{ color: pnl >= 0 ? 'var(--accent)' : 'var(--danger)' }}>{pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}%</div>
          <div className="kpi-sub">{pnl >= 0 ? '+' : ''}${((nav * pnl) / 100).toFixed(2)} aujourd'hui</div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">Positions ouvertes <Help tip="Nombre de positions actuellement détenues par les agents IA." /></div>
          <div className="kpi-value">{positions.length}</div>
          <div className="kpi-sub">{positions.length > 0 ? ((positions.reduce((s, p) => s + p.sizeUsd, 0) / nav) * 100).toFixed(1) : '0'}% du capital engagé</div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">Régime de risque <Help tip="NORMAL = pas d'alerte, ELEVATED = perte > 2%, CRISIS = perte > 3%." /></div>
          <div className="kpi-value" style={{
            color: portfolio.risk_regime === 'NORMAL' ? 'var(--accent)' :
                   portfolio.risk_regime === 'ELEVATED' ? 'var(--warn)' : 'var(--danger)',
            fontFamily: 'var(--mono)', fontSize: 28,
          }}>{portfolio.risk_regime}</div>
          <div className="kpi-sub">{lastUpdateStr}</div>
        </div>
      </div>

      {/* Positions tabs */}
      <div className="card">
        <div className="card-h">
          <div className="flex gap-3 center">
            <button
              onClick={() => setTab('open')}
              style={{
                padding: '4px 0', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 13, fontWeight: 600,
                color: tab === 'open' ? 'var(--ink)' : 'var(--ink-3)',
                borderBottom: tab === 'open' ? '2px solid var(--accent)' : '2px solid transparent',
              }}
            >
              Positions ouvertes <span style={{ color: 'var(--ink-4)' }}>({openPositions.length})</span>
            </button>
            <button
              onClick={() => setTab('hist')}
              style={{
                padding: '4px 0', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 13, fontWeight: 600,
                color: tab === 'hist' ? 'var(--ink)' : 'var(--ink-3)',
                borderBottom: tab === 'hist' ? '2px solid var(--accent)' : '2px solid transparent',
              }}
            >
              Historique <span style={{ color: 'var(--ink-4)' }}>({history.length})</span>
            </button>
          </div>
          <span className="card-h-meta">{lastUpdateStr !== '—' ? `dernière MAJ ${lastUpdateStr}` : 'en attente de connexion'}</span>
        </div>

        {tab === 'open' && (
          <div>
            {openPositions.length === 0 ? (
              <div style={{ padding: '24px 18px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
                Aucune position ouverte — le système IA attend les prochaines opportunités
              </div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '90px 70px 70px 100px 100px 1fr 110px 90px', padding: '10px 18px', borderBottom: '1px solid var(--rule)', fontSize: 10, fontFamily: 'var(--mono)', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                  <span>Actif</span><span>Sens</span><span>Qté</span><span>Entrée</span><span>Marché</span><span>Décision IA</span><span style={{ textAlign: 'right' }}>P&L $</span><span style={{ textAlign: 'right' }}>P&L %</span>
                </div>
                {openPositions.map((p, i) => (
                  <div key={p.sym} style={{ display: 'grid', gridTemplateColumns: '90px 70px 70px 100px 100px 1fr 110px 90px', padding: '14px 18px', borderBottom: i < openPositions.length - 1 ? '1px solid var(--rule)' : 'none', alignItems: 'center', fontSize: 13 }}>
                    <span className="mono" style={{ fontWeight: 600 }}>{p.sym}</span>
                    <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontFamily: 'var(--mono)', background: 'var(--accent-soft)', color: 'var(--accent)' }}>{p.side}</span>
                    <span className="mono" style={{ color: 'var(--ink-3)' }}>{p.qty.toFixed(2)}</span>
                    <span className="mono">${p.entry.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                    <span className="mono">${p.mark.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ padding: '2px 6px', borderRadius: 3, fontSize: 10, fontFamily: 'var(--mono)', background: (SIGNAL_COLOR[p.signal] || 'var(--ink-4)').replace('var(', 'var(') + '15', color: SIGNAL_COLOR[p.signal] || 'var(--ink-4)' }}>
                        {SIGNAL_LABEL[p.signal] || p.signal}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                        {p.confidence > 0 ? `confiance ${p.confidence}%` : ''}
                      </span>
                    </span>
                    <span className="mono" style={{ textAlign: 'right', fontWeight: 600, color: p.pnl >= 0 ? 'var(--accent)' : 'var(--danger)' }}>{p.pnl >= 0 ? '+' : ''}${p.pnl.toFixed(2)}</span>
                    <span className="mono" style={{ textAlign: 'right', color: p.pct >= 0 ? 'var(--accent)' : 'var(--danger)' }}>{p.pct >= 0 ? '+' : ''}{p.pct.toFixed(2)}%</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {tab === 'hist' && (
          <div>
            {history.length === 0 ? (
              <div style={{ padding: '24px 18px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
                Aucun trade fermé
              </div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '100px 70px 70px 1fr 100px 80px', padding: '10px 18px', borderBottom: '1px solid var(--rule)', fontSize: 10, fontFamily: 'var(--mono)', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                  <span>Date</span><span>Actif</span><span>Action</span><span>Raison</span><span style={{ textAlign: 'right' }}>P&L $</span><span style={{ textAlign: 'right' }}>P&L %</span>
                </div>
                {history.slice(0, 20).map((h, i) => (
                  <div key={h.id} style={{ display: 'grid', gridTemplateColumns: '100px 70px 70px 1fr 100px 80px', padding: '14px 18px', borderBottom: i < Math.min(history.length, 20) - 1 ? '1px solid var(--rule)' : 'none', alignItems: 'center', fontSize: 13 }}>
                    <span className="mono" style={{ color: 'var(--ink-3)' }}>{h.closedAt ? new Date(h.closedAt).toLocaleDateString('fr-FR') : '—'}</span>
                    <span className="mono" style={{ fontWeight: 600 }}>{h.ticker}</span>
                    <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontFamily: 'var(--mono)', background: h.action === 'BUY' ? 'var(--accent-soft)' : 'var(--danger-soft)', color: h.action === 'BUY' ? 'var(--accent)' : 'var(--danger)' }}>{h.action}</span>
                    <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>{h.closeReason || '—'} {h.reasoning ? `· ${h.reasoning.slice(0, 40)}` : ''}</span>
                    <span className="mono" style={{ textAlign: 'right', fontWeight: 600, color: (h.pnlUsd || 0) >= 0 ? 'var(--accent)' : 'var(--danger)' }}>{(h.pnlUsd || 0) >= 0 ? '+' : ''}${(h.pnlUsd || 0).toFixed(2)}</span>
                    <span className="mono" style={{ textAlign: 'right', color: (h.pnlUsd || 0) >= 0 ? 'var(--accent)' : 'var(--danger)' }}>
                      {h.filledPrice > 0 && h.closePrice ? `${((h.closePrice - h.filledPrice) / h.filledPrice * 100 >= 0 ? '+' : '')}${((h.closePrice - h.filledPrice) / h.filledPrice * 100).toFixed(2)}%` : '—'}
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* Bottom row */}
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
        <div className="card">
          <div className="card-h"><div className="card-h-title">Allocation <Help tip="Répartition du capital entre les positions ouvertes et les liquidités." /></div></div>
          <div style={{ padding: 20 }}>
            {allocation.length === 0 || (allocation.length === 1 && allocation[0].label === 'Cash') ? (
              <div style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 16 }}>
                100% en liquidités — aucun trade actif
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', height: 12, borderRadius: 999, overflow: 'hidden', background: 'var(--bg-elev-2)', marginBottom: 18 }}>
                  {allocation.map((a, i) => (
                    <div key={a.label} style={{ width: `${Math.max(a.pct, 2)}%`, background: a.color }} title={`${a.label}: ${a.pct.toFixed(1)}%`} />
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(allocation.length, 5)}, 1fr)`, gap: 12 }}>
                  {allocation.map((a) => (
                    <div key={a.label}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: a.color }} />
                        <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{a.label}</span>
                      </div>
                      <div className="mono" style={{ fontSize: 14 }}>{a.pct.toFixed(1)}%</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-h"><div className="card-h-title">Indicateurs clés <Help tip="Mesures calculées à partir de l'historique réel des trades." /></div></div>
          <div style={{ padding: 6 }}>
            {metrics.totalTrades === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
                Pas encore de trades — les indicateurs apparaîtront avec les premières décisions
              </div>
            ) : (
              [
                ['Win rate', `${metrics.winRate.toFixed(0)}%`, 'Pourcentage de trades fermés en gain.'],
                ['Drawdown max', `${metrics.maxDD}%`, 'Pire chute depuis le sommet du portefeuille.'],
                ['Trades fermés', `${metrics.totalTrades}`, 'Nombre total de trades fermés depuis le début.'],
                ['Trades / mois', `${metrics.tradesPerMonth}`, 'Trades fermés dans les 30 derniers jours.'],
              ].map(([k, v, tip], i) => (
                <div key={k as string} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', borderBottom: i < 3 ? '1px solid var(--rule)' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13 }}>{k as string}</span>
                    <Help tip={tip as string} />
                  </div>
                  <span className="mono" style={{ fontWeight: 600 }}>{v as string}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}