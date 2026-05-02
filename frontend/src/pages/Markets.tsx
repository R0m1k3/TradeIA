import { useState, useEffect, useMemo } from 'react';
import { usePortfolioStore } from '../store/portfolio.store';
import { useSignalsStore } from '../store/signals.store';
import { useConfigStore } from '../store/config.store';
import { CandlestickChart } from '../components/charts/CandlestickChart';
import type { OHLCVBar } from '../types';

function Help({ tip }: { tip: string }) {
  return <span className="card-h-help" data-tip={tip}>i</span>;
}

const AGENT_ORDER = ['collector', 'analyst', 'bull', 'bear', 'strategist', 'risk', 'reporter'];
const AGENT_PIPELINE_NAMES: Record<string, { num: string; name: string; role: string; color: string }> = {
  collector: { num: '01', name: 'Collecteur', role: 'Récolte les données', color: 'var(--info)' },
  analyst: { num: '02', name: 'Analyste', role: 'Lit les chiffres', color: 'var(--accent)' },
  bull: { num: '03', name: 'Bull', role: 'Cherche le haussier', color: 'var(--accent)' },
  bear: { num: '04', name: 'Bear', role: 'Cherche le baissier', color: 'var(--danger)' },
  risk: { num: '05', name: 'Risk', role: 'Calib. exposition', color: 'var(--warn)' },
  strategist: { num: '06', name: 'Modérateur', role: 'Tranche', color: 'oklch(0.74 0.10 280)' },
  reporter: { num: '07', name: 'Reporter', role: 'Archive', color: 'var(--ink-4)' },
};

export function Markets() {
  const { portfolio } = usePortfolioStore();
  const { signals, market, agents, cycleTimeline, lastUpdate } = useSignalsStore();
  const { config } = useConfigStore();
  const [ohlcv, setOhlcv] = useState<OHLCVBar[]>([]);
  const [chartTicker, setChartTicker] = useState('QQQ');
  const [chartInterval, setChartInterval] = useState<'15m' | '1h' | '1d'>('1d');

  // Fetch real OHLCV data from backend
  useEffect(() => {
    const api = import.meta.env.VITE_API_URL || '/api';
    let cancelled = false;
    fetch(`${api}/market/ohlcv/${chartTicker}?interval=${chartInterval}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: OHLCVBar[]) => {
        if (!cancelled && data.length > 0) setOhlcv(data);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [chartTicker, chartInterval]);

  // Determine which ticker to chart: first position, or QQQ default
  useEffect(() => {
    if (portfolio.positions.length > 0 && portfolio.positions[0].ticker) {
      setChartTicker(portfolio.positions[0].ticker);
    }
  }, [portfolio.positions]);

  const flux = cycleTimeline.slice(-7).map((e) => ({
    t: new Date(e.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    who: e.agent.toUpperCase(),
    color: e.status === 'ok' ? 'var(--accent)' : e.status === 'error' ? 'var(--danger)' : 'var(--info)',
    msg: e.label,
  }));

  const isCycleActive = Object.values(agents).some((a) => a.status === 'running');
  const completedSteps = AGENT_ORDER.filter((n) => (agents as any)[n]?.status === 'ok').length;

  const investedUsd = portfolio.positions.reduce((s, p) => s + p.sizeUsd, 0);
  const exposurePct = portfolio.total_usd > 0 ? ((investedUsd / portfolio.total_usd) * 100).toFixed(0) : '0';
  const cashPct = portfolio.total_usd > 0 ? ((portfolio.cash_usd / portfolio.total_usd) * 100).toFixed(0) : '100';

  return (
    <div className="page">
      <div className="flex between center" style={{ marginBottom: 22 }}>
        <div>
          <h1 className="h1">Vue Marché</h1>
          <div style={{ color: 'var(--ink-3)', fontSize: 13, marginTop: 6 }}>
            Synthèse temps réel : indicateurs, pipeline d'agents IA et graphiques de l'actif suivi.
          </div>
        </div>
      </div>

      {/* Onboarding banner - only show if no positions */}
      {portfolio.positions.length === 0 && (
        <div className="card" style={{ marginBottom: 16, background: 'linear-gradient(180deg, var(--accent-soft), transparent)', borderColor: 'var(--accent-line)' }}>
          <div style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'grid', placeItems: 'center', fontFamily: 'var(--serif)', fontStyle: 'italic' }}>i</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>Mode démonstration actif — aucun ordre réel n'est envoyé.</div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>Configurez vos API et attendez le premier cycle IA pour voir les données apparaître.</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* KPIs — real data */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        {[
          { label: 'Valeur portefeuille', value: `$${portfolio.total_usd.toLocaleString('en-US', { maximumFractionDigits: 0 })}`, sub: `${portfolio.daily_pnl_pct >= 0 ? '+' : ''}${portfolio.daily_pnl_pct.toFixed(2)}% jour`, color: portfolio.daily_pnl_pct >= 0 ? 'var(--accent)' : 'var(--danger)' },
          { label: 'Capital disponible', value: `$${portfolio.cash_usd.toLocaleString('en-US', { maximumFractionDigits: 0 })}`, sub: `${cashPct}% en cash`, color: null },
          { label: 'Positions ouvertes', value: String(portfolio.positions.length), sub: `exposition ${exposurePct}%`, color: null },
          { label: 'Niveau de risque', value: portfolio.risk_regime, sub: `VIX ${market.vix > 0 ? market.vix.toFixed(1) : '—'} · Fear/Greed ${market.fear_greed > 0 ? market.fear_greed : '—'}`, color: portfolio.risk_regime === 'NORMAL' ? 'var(--accent)' : portfolio.risk_regime === 'ELEVATED' ? 'var(--warn)' : 'var(--danger)' },
        ].map((kpi, i) => (
          <div key={i} className="card kpi">
            <div className="kpi-label">{kpi.label}</div>
            <div className="kpi-value" style={{ color: kpi.color || 'var(--ink)', fontSize: kpi.label === 'Niveau de risque' ? 26 : 32, fontFamily: kpi.label === 'Niveau de risque' ? 'var(--mono)' : 'var(--serif)' }}>{kpi.value}</div>
            <div className="kpi-sub">{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* Pipeline — real agent status */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-h">
          <div className="card-h-title">Pipeline d'agents IA <Help tip="Chaque agent traite l'information dans l'ordre. Une décision n'est prise que quand tous ont parlé." /></div>
          <span className="card-h-meta">{isCycleActive ? 'cycle en cours' : 'en attente'} · étape {completedSteps}/7</span>
        </div>
        <div style={{ padding: '24px 18px', display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 12, position: 'relative' }}>
          {AGENT_ORDER.map((id, i) => {
            const m = AGENT_PIPELINE_NAMES[id];
            const realAgent = (agents as any)[id] || { status: 'idle' };
            const realStatus = realAgent.status === 'ok' ? 'done' : realAgent.status === 'running' ? 'active' : 'wait';
            return (
              <div key={id} style={{ textAlign: 'center', position: 'relative' }}>
                <div style={{
                  width: 56, height: 56, margin: '0 auto 12px',
                  borderRadius: 14,
                  border: '1.5px solid',
                  borderColor: realStatus === 'active' ? m.color : realStatus === 'done' ? 'var(--rule-strong)' : 'var(--rule)',
                  background: realStatus === 'active' ? m.color + '22' : realStatus === 'done' ? 'var(--bg-elev-2)' : 'transparent',
                  display: 'grid', placeItems: 'center',
                  fontFamily: 'var(--mono)', fontSize: 13,
                  color: realStatus === 'active' ? m.color : realStatus === 'done' ? 'var(--ink)' : 'var(--ink-4)',
                  fontWeight: 600,
                  position: 'relative',
                }}>
                  {realStatus === 'done' ? '✓' : m.num}
                  {realStatus === 'active' && <span style={{ position: 'absolute', inset: -6, borderRadius: 18, border: `2px solid ${m.color}`, opacity: 0.4 }} />}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{m.name}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{m.role}</div>
                {i < 6 && <div style={{ position: 'absolute', top: 28, right: -6, width: 12, height: 1, background: 'var(--rule-strong)' }} />}
              </div>
            );
          })}
        </div>
      </div>

      {/* Chart + flux */}
      <div className="grid" style={{ gridTemplateColumns: '1.6fr 1fr', gap: 12 }}>
        <div className="card">
          <div className="card-h">
            <div className="flex gap-3 center">
              <span style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 600 }}>
                {chartTicker}
              </span>
              <span className="mono" style={{ fontSize: 18, fontWeight: 600 }}>
                {market.nasdaq_change_pct !== 0 ? `${market.nasdaq_change_pct >= 0 ? '+' : ''}${market.nasdaq_change_pct.toFixed(2)}%` : '—'}
              </span>
              <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
                {(['15m', '1h', '1d'] as const).map((iv) => (
                  <button key={iv} onClick={() => setChartInterval(iv)} style={{
                    padding: '2px 8px', borderRadius: 4, fontSize: 10, fontFamily: 'var(--mono)',
                    border: '1px solid', cursor: 'pointer',
                    borderColor: chartInterval === iv ? 'var(--accent)' : 'var(--rule)',
                    background: chartInterval === iv ? 'var(--accent-soft)' : 'transparent',
                    color: chartInterval === iv ? 'var(--accent)' : 'var(--ink-4)',
                  }}>{iv}</button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {market.nasdaq_status && (
                <span style={{ fontSize: 11, color: market.nasdaq_status.isOpen ? 'var(--accent)' : 'var(--ink-3)' }}>
                  {market.nasdaq_status.isOpen ? 'Ouvert' : market.nasdaq_status.nextOpen || 'Fermé'}
                </span>
              )}
            </div>
          </div>
          <div style={{ padding: 16, height: 320, position: 'relative' }}>
            {ohlcv.length > 0 ? (
              <CandlestickChart data={ohlcv} ticker={chartTicker} height={288} />
            ) : (
              <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--ink-3)' }}>
                Graphique en attente de données
              </div>
            )}
          </div>
        </div>
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="card-h">
            <div className="card-h-title">Flux des agents <Help tip="Chaque ligne est une action ou une analyse postée par un agent IA en temps réel." /></div>
            <span className="card-h-meta">live</span>
          </div>
          <div style={{ flex: 1, overflow: 'auto', maxHeight: 320 }}>
            {flux.length === 0 ? (
              <div style={{ padding: '24px 14px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>En attente du cycle IA...</div>
            ) : (
              flux.map((f, i) => (
                <div key={i} style={{ padding: '12px 14px', borderBottom: i < flux.length - 1 ? '1px solid var(--rule)' : 'none' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span className="mono" style={{ fontSize: 10, color: f.color, letterSpacing: '0.06em', fontWeight: 600 }}>{f.who}</span>
                    <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>{f.t}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5 }}>{f.msg}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}