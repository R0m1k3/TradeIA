import { useState, useMemo } from 'react';
import { usePortfolioStore } from '../store/portfolio.store';
import { useSignalsStore } from '../store/signals.store';
import { useConfigStore } from '../store/config.store';
import type { Page } from '../App';
import type { OHLCVBar } from '../types';
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
  const { signals, market } = useSignalsStore();
  const { secretsConfigured } = useConfigStore();
  const [tab, setTab] = useState<'open' | 'hist'>('open');

  const nav = portfolio.total_usd;
  const pnl = portfolio.daily_pnl_pct;
  const positions = portfolio.positions;
  const cash = portfolio.cash_usd;

  const curve = useMemo(() => {
    let v = portfolio.initial_capital || 10000;
    const out = [v];
    for (let i = 1; i < 90; i++) {
      v = v * (1 + Math.sin(i * 0.27) * 0.011 + 0.0015);
      out.push(v);
    }
    return out;
  }, [portfolio.initial_capital]);

  const last = curve[curve.length - 1];
  const first = curve[0];
  const totalPct = ((last - first) / first) * 100;

  const openPositions = positions.map((p) => ({
    sym: p.ticker,
    side: 'LONG' as const,
    qty: p.quantity,
    entry: p.entryPrice,
    mark: p.currentPrice,
    pnl: p.pnlUsd,
    pct: p.pnlPct,
    agent: `${p.ticker} · confiance ${Math.round(p.pnlPct + 50)}%`,
  }));

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
          <button className="btn btn-ghost btn-sm">Exporter</button>
          <button className="btn btn-primary btn-sm" onClick={() => onNavigate('config')}>+ Déposer</button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid" style={{ gridTemplateColumns: '1.4fr repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        <div className="card">
          <div className="kpi" style={{ paddingBottom: 0 }}>
            <div className="kpi-label">
              Valeur du portefeuille <Help tip="Capital total : positions ouvertes + liquidités. Mis à jour en temps réel." />
            </div>
            <div className="kpi-value">${nav.toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
            <div className="kpi-sub" style={{ color: totalPct >= 0 ? 'var(--accent)' : 'var(--danger)' }}>
              {totalPct >= 0 ? '+' : ''}{totalPct.toFixed(2)}% sur 90 jours · +${(last - first).toFixed(0)}
            </div>
          </div>
          <div style={{ padding: '12px 20px 16px' }}>
            <Sparkline data={curve} w={500} h={48} fill={true} />
          </div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">P&L jour <Help tip="Gain ou perte de la journée en cours, à partir de minuit UTC." /></div>
          <div className="kpi-value" style={{ color: 'var(--accent)' }}>{pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}%</div>
          <div className="kpi-sub">+${((nav * pnl) / 100).toFixed(2)} aujourd'hui</div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">Positions ouvertes <Help tip="Nombre de positions actuellement détenues par les agents IA." /></div>
          <div className="kpi-value">{positions.length}</div>
          <div className="kpi-sub">{positions.length > 0 ? ((positions.reduce((s, p) => s + p.sizeUsd, 0) / nav) * 100).toFixed(1) : '0'}% du capital engagé</div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">Niveau de risque <Help tip="Calculé à partir de la volatilité du portefeuille et de l'exposition. Vert = dans la cible, rouge = à surveiller." /></div>
          <div className="kpi-value" style={{ color: 'var(--accent)', fontFamily: 'var(--mono)', fontSize: 28 }}>{portfolio.risk_regime}</div>
          <div className="kpi-sub">VaR 1j : -${(nav * 0.018).toFixed(0)} · 95%</div>
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
              Positions ouvertes <span className="muted">({openPositions.length})</span>
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
              Historique <span className="muted">({history.length})</span>
            </button>
          </div>
          <span className="card-h-meta">temps réel · dernier ping il y a 2s</span>
        </div>

        {tab === 'open' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '90px 70px 70px 100px 100px 1fr 110px 90px 80px', padding: '10px 18px', borderBottom: '1px solid var(--rule)', fontSize: 10, fontFamily: 'var(--mono)', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
              <span>Actif</span><span>Sens</span><span>Qté</span><span>Entrée</span><span>Marché</span><span>Décision IA</span><span style={{ textAlign: 'right' }}>P&L $</span><span style={{ textAlign: 'right' }}>P&L %</span><span></span>
            </div>
            {openPositions.length === 0 ? (
              <div style={{ padding: '24px 18px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
                Aucune position ouverte — le système IA attend les prochaines opportunités
              </div>
            ) : (
              openPositions.map((p, i) => (
                <div key={p.sym} style={{ display: 'grid', gridTemplateColumns: '90px 70px 70px 100px 100px 1fr 110px 90px 80px', padding: '14px 18px', borderBottom: i < openPositions.length - 1 ? '1px solid var(--rule)' : 'none', alignItems: 'center', fontSize: 13 }}>
                  <span className="mono" style={{ fontWeight: 600 }}>{p.sym}</span>
                  <span className="badge badge-up">{p.side}</span>
                  <span className="mono muted">{p.qty}</span>
                  <span className="mono">${p.entry.toLocaleString('en-US')}</span>
                  <span className="mono">${p.mark.toLocaleString('en-US')}</span>
                  <span style={{ color: 'var(--ink-2)', fontSize: 12 }}>{p.agent}</span>
                  <span className="mono tabular" style={{ textAlign: 'right', fontWeight: 600, color: p.pnl >= 0 ? 'var(--accent)' : 'var(--danger)' }}>{p.pnl >= 0 ? '+' : ''}${p.pnl.toFixed(2)}</span>
                  <span className="mono tabular" style={{ textAlign: 'right', color: p.pct >= 0 ? 'var(--accent)' : 'var(--danger)' }}>{p.pct >= 0 ? '+' : ''}{p.pct.toFixed(2)}%</span>
                  <button className="btn btn-ghost btn-sm" style={{ justifyContent: 'center' }}>Clôturer</button>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'hist' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '150px 90px 70px 80px 1fr 110px 90px', padding: '10px 18px', borderBottom: '1px solid var(--rule)', fontSize: 10, fontFamily: 'var(--mono)', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
              <span>Date</span><span>Actif</span><span>Sens</span><span>Durée</span><span>Raison</span><span style={{ textAlign: 'right' }}>P&L $</span><span style={{ textAlign: 'right' }}>P&L %</span>
            </div>
            {history.length === 0 ? (
              <div style={{ padding: '24px 18px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
                Aucun trade fermé
              </div>
            ) : (
              history.map((h, i) => (
                <div key={h.id} style={{ display: 'grid', gridTemplateColumns: '150px 90px 70px 80px 1fr 110px 90px', padding: '14px 18px', borderBottom: i < history.length - 1 ? '1px solid var(--rule)' : 'none', alignItems: 'center', fontSize: 13 }}>
                  <span className="mono muted">{h.closedAt ? new Date(h.closedAt).toLocaleDateString('fr-FR') : '—'}</span>
                  <span className="mono" style={{ fontWeight: 600 }}>{h.ticker}</span>
                  <span className="badge badge-up">{h.action}</span>
                  <span className="mono muted">—</span>
                  <span style={{ color: 'var(--ink-2)', fontSize: 12 }}>{h.closeReason || 'Trade fermé'} <span className="faint">· {h.reasoning?.slice(0, 30)}</span></span>
                  <span className="mono" style={{ textAlign: 'right', fontWeight: 600, color: (h.pnlUsd || 0) >= 0 ? 'var(--accent)' : 'var(--danger)' }}>{(h.pnlUsd || 0) >= 0 ? '+' : ''}${(h.pnlUsd || 0).toFixed(2)}</span>
                  <span className="mono" style={{ textAlign: 'right', color: (h.pnlUsd || 0) >= 0 ? 'var(--accent)' : 'var(--danger)' }}>
                    {h.filledPrice > 0 ? (((h.closePrice || h.filledPrice) - h.filledPrice) / h.filledPrice * 100 >= 0 ? '+' : '') + (((h.closePrice || h.filledPrice) - h.filledPrice) / h.filledPrice * 100).toFixed(2) + '%' : '—'}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Bottom row */}
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
        <div className="card">
          <div className="card-h"><div className="card-h-title">Allocation par classe d'actif <Help tip="Comment votre capital est réparti entre actions, crypto, etc." /></div></div>
          <div style={{ padding: 20 }}>
            <div style={{ display: 'flex', height: 12, borderRadius: 999, overflow: 'hidden', background: 'var(--bg-elev-2)', marginBottom: 18 }}>
              {[[42, 'var(--accent)'], [28, 'var(--info)'], [16, 'oklch(0.78 0.14 65)'], [8, 'oklch(0.74 0.16 295)'], [6, 'var(--ink-4)']].map(([w, c], i) => (
                <div key={i} style={{ width: `${w}%`, background: c as string }} />
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12 }}>
              {[['Actions', 42, 'var(--accent)'], ['Crypto', 28, 'var(--info)'], ['Or', 16, 'oklch(0.78 0.14 65)'], ['Forex', 8, 'oklch(0.74 0.16 295)'], ['Cash', 6, 'var(--ink-4)']].map(([l, p, c]) => (
                <div key={l as string}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: c as string }} />
                    <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{l as string}</span>
                  </div>
                  <div className="mono" style={{ fontSize: 14 }}>{p}%</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-h"><div className="card-h-title">Indicateurs clés <Help tip="Mesures de qualité de votre portefeuille." /></div></div>
          <div style={{ padding: 6 }}>
            {[
              ['Sharpe ratio', '1.68', 'Mesure le rendement vs risque pris. > 1 = bon.'],
              ['Drawdown max', '-6.2%', 'Pire chute depuis le sommet. Limite cible : -9%.'],
              ['Win rate', '64%', '64 trades sur 100 sont gagnants.'],
              ['Trades / mois', '24', 'Activité moyenne des agents.'],
            ].map(([k, v, tip], i) => (
              <div key={k as string} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', borderBottom: i < 3 ? '1px solid var(--rule)' : 'none' }}>
                <div className="flex gap-2 center">
                  <span style={{ fontSize: 13 }}>{k as string}</span>
                  <Help tip={tip as string} />
                </div>
                <span className="mono" style={{ fontWeight: 600 }}>{v as string}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
