import { useState, useMemo } from 'react';
import { usePortfolioStore } from '../store/portfolio.store';
import { useSignalsStore } from '../store/signals.store';
import { CandlestickChart } from '../components/charts/CandlestickChart';
import type { OHLCVBar } from '../types';

function Help({ tip }: { tip: string }) {
  return <span className="card-h-help" data-tip={tip}>i</span>;
}

function Candles({ candles }: { candles: { o: number; h: number; l: number; c: number }[] }) {
  const w = 800, h = 280, pad = 24;
  const min = Math.min(...candles.map((c) => c.l));
  const max = Math.max(...candles.map((c) => c.h));
  const r = max - min || 1;
  const cw = (w - pad * 2) / candles.length;
  const ys = (v: number) => pad + (1 - (v - min) / r) * (h - pad * 2);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="100%" preserveAspectRatio="none">
      {[0.25, 0.5, 0.75].map((p) => (
        <line key={p} x1={pad} x2={w - pad} y1={pad + p * (h - pad * 2)} y2={pad + p * (h - pad * 2)} stroke="var(--rule)" strokeWidth="1" strokeDasharray="2 4" />
      ))}
      {candles.map((c, i) => {
        const up = c.c >= c.o;
        const x = pad + i * cw + cw / 2;
        const color = up ? 'var(--accent)' : 'var(--danger)';
        return (
          <g key={i}>
            <line x1={x} x2={x} y1={ys(c.h)} y2={ys(c.l)} stroke={color} strokeWidth="1" />
            <rect x={x - cw * 0.35} y={ys(Math.max(c.o, c.c))} width={cw * 0.7} height={Math.max(1, Math.abs(ys(c.o) - ys(c.c)))} fill={color} />
          </g>
        );
      })}
      {[min, (min + max) / 2, max].map((v, i) => (
        <text key={i} x={w - pad + 4} y={ys(v) + 3} fill="var(--ink-3)" fontFamily="var(--mono)" fontSize="9">${v.toFixed(2)}</text>
      ))}
    </svg>
  );
}

export function Markets() {
  const { portfolio } = usePortfolioStore();
  const { signals, market, agents, cycleTimeline } = useSignalsStore();
  const candles = useMemo(() => {
    const arr = []; let p = 224;
    for (let i = 0; i < 60; i++) {
      const o = p;
      const c = o + (Math.sin(i * 0.4) * 2 + (Math.random() - 0.5) * 1.4);
      const h = Math.max(o, c) + Math.random() * 1.2;
      const l = Math.min(o, c) - Math.random() * 1.2;
      arr.push({ o, h, l, c }); p = c;
    }
    return arr;
  }, []);

  const flux = cycleTimeline.slice(-7).map((e, i) => ({
    t: new Date(e.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    who: e.agent.toUpperCase(),
    color: e.status === 'ok' ? 'var(--accent)' : e.status === 'error' ? 'var(--danger)' : 'var(--info)',
    msg: e.label,
  }));

  const agentOrder = ['collector', 'analyst', 'bull', 'bear', 'strategist', 'risk', 'reporter'];
  const isCycleActive = Object.values(agents).some((a) => a.status === 'running');

  return (
    <div className="page">
      <div className="flex between center" style={{ marginBottom: 22 }}>
        <div>
          <h1 className="h1">Vue Marché</h1>
          <div style={{ color: 'var(--ink-3)', fontSize: 13, marginTop: 6 }}>
            Synthèse temps réel : indicateurs, pipeline d'agents IA et graphiques de l'actif suivi.
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-ghost btn-sm">AAPL ▾</button>
          <button className="btn btn-primary btn-sm">+ Nouvelle session</button>
        </div>
      </div>

      {/* Onboarding banner */}
      <div className="card" style={{ marginBottom: 16, background: 'linear-gradient(180deg, var(--accent-soft), transparent)', borderColor: 'var(--accent-line)' }}>
        <div style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
          <div className="flex gap-3 center">
            <span style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'grid', placeItems: 'center', fontFamily: 'var(--serif)', fontStyle: 'italic' }}>i</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Mode démonstration actif — aucun ordre réel n'est envoyé.</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>Connectez un courtier dans Configuration pour passer en réel. Toutes les données affichées sont simulées.</div>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm">Connecter un courtier →</button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        {[
          ['Valeur portefeuille', `$${portfolio.total_usd.toLocaleString('en-US')}`, '+0.84% jour', 'var(--accent)'],
          ['Capital disponible', `$${portfolio.cash_usd.toLocaleString('en-US')}`, `${((portfolio.cash_usd / portfolio.total_usd) * 100).toFixed(0)}% en cash`, null],
          ['Positions ouvertes', String(portfolio.positions.length), 'exposition 68%', null],
          ['Niveau de risque', portfolio.risk_regime, `VaR 1j : -$${(portfolio.total_usd * 0.018).toFixed(0)}`, 'var(--accent)'],
        ].map(([l, v, s, c], i) => (
          <div key={i} className="card kpi">
            <div className="kpi-label">{l as string}</div>
            <div className="kpi-value" style={{ color: c || 'var(--ink)', fontSize: l === 'Niveau de risque' ? 26 : 32, fontFamily: l === 'Niveau de risque' ? 'var(--mono)' : 'var(--serif)' }}>{v as string}</div>
            <div className="kpi-sub">{s as string}</div>
          </div>
        ))}
      </div>

      {/* Pipeline */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-h">
          <div className="card-h-title">Pipeline d'agents IA <Help tip="Chaque agent traite l'information dans l'ordre. Une décision n'est prise que quand tous ont parlé." /></div>
          <span className="card-h-meta">{isCycleActive ? 'cycle en cours' : 'en attente'} · étape {agentOrder.filter((n) => (agents as any)[n]?.status === 'ok').length}/7 · ~2s</span>
        </div>
        <div style={{ padding: '24px 18px', display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 12, position: 'relative' }}>
          {[
            ['01', 'Collecteur', 'Récolte les données', 'done', 'var(--info)'],
            ['02', 'Analyste', 'Lit les chiffres', 'done', 'var(--accent)'],
            ['03', 'Bull', 'Cherche le haussier', 'done', 'var(--accent)'],
            ['04', 'Bear', 'Cherche le baissier', 'done', 'var(--danger)'],
            ['05', 'Risk', 'Calib. exposition', 'active', 'var(--warn)'],
            ['06', 'Modérateur', 'Tranche', 'wait', 'oklch(0.74 0.10 280)'],
            ['07', 'Reporter', 'Archive', 'wait', 'var(--ink-4)'],
          ].map(([n, name, role, st, color], i) => {
            const realAgent = (agents as any)[name.toLowerCase().replace(' ', '')] || { status: 'idle' };
            const realStatus = realAgent.status === 'ok' ? 'done' : realAgent.status === 'running' ? 'active' : 'wait';
            return (
              <div key={n as string} style={{ textAlign: 'center', position: 'relative' }}>
                <div style={{
                  width: 56, height: 56, margin: '0 auto 12px',
                  borderRadius: 14,
                  border: '1.5px solid',
                  borderColor: realStatus === 'active' ? color : realStatus === 'done' ? 'var(--rule-strong)' : 'var(--rule)',
                  background: realStatus === 'active' ? (color as string) + '22' : realStatus === 'done' ? 'var(--bg-elev-2)' : 'transparent',
                  display: 'grid', placeItems: 'center',
                  fontFamily: 'var(--mono)', fontSize: 13,
                  color: realStatus === 'active' ? color : realStatus === 'done' ? 'var(--ink)' : 'var(--ink-4)',
                  fontWeight: 600,
                  position: 'relative',
                }}>
                  {realStatus === 'done' ? '✓' : n}
                  {realStatus === 'active' && <span style={{ position: 'absolute', inset: -6, borderRadius: 18, border: `2px solid ${color}`, opacity: 0.4, animation: 'pulse 2s infinite' }} />}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{name as string}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{role as string}</div>
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
              <span style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 600 }}>AAPL</span>
              <span className="mono" style={{ fontSize: 18, fontWeight: 600 }}>$232.18</span>
              <span className="badge badge-up">+0.42%</span>
            </div>
            <div className="flex gap-2">
              {['1m', '5m', '15m', '1h', '4h', '1d'].map((tf, i) => (
                <button key={tf} style={{
                  padding: '4px 10px', fontSize: 11, fontFamily: 'var(--mono)',
                  border: '1px solid var(--rule)',
                  background: i === 3 ? 'var(--accent-soft)' : 'transparent',
                  color: i === 3 ? 'var(--accent)' : 'var(--ink-3)',
                  borderRadius: 4, cursor: 'pointer',
                }}>{tf}</button>
              ))}
            </div>
          </div>
          <div style={{ padding: 16, height: 320, position: 'relative' }}>
            <Candles candles={candles} />
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
                  <div className="flex between" style={{ marginBottom: 4 }}>
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
