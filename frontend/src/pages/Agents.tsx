import { useState, useEffect } from 'react';
import { useSignalsStore } from '../store/signals.store';
import { useConfigStore } from '../store/config.store';
import type { AgentState } from '../types';

const AGENT_META: Record<string, { n: string; name: string; role: string; color: string; desc: string }> = {
  collector: { n: '01', name: 'Collecteur', role: 'Récolte les données', color: 'var(--info)', desc: 'Ingère les flux OHLC, données fondamentales, macro et secteur pour alimenter les autres agents.' },
  analyst: { n: '02', name: 'Analyste', role: 'Analyse technique & fondamentale', color: 'var(--accent)', desc: 'Surveille fondamentaux, ratios, bilans, corrélations sectorielles et signaux techniques multi-timeframe.' },
  bull: { n: '03', name: 'Bull', role: 'Cherche le haussier', color: 'var(--accent)', desc: 'Identifie les setups haussiers : breakouts, supports, divergences positives, catalyseurs fondamentaux.' },
  bear: { n: '04', name: 'Bear', role: 'Cherche le baissier', color: 'var(--danger)', desc: 'Identifie les retournements baissiers, divergences négatives, cassures de structure, risques macro.' },
  risk: { n: '05', name: 'Risk', role: "Calibre l'exposition", color: 'var(--warn)', desc: "Dimensionne chaque position via Kelly fractionné, oppose son veto si le risque est trop élevé." },
  strategist: { n: '06', name: 'Modérateur', role: 'Tranche', color: 'oklch(0.74 0.10 280)', desc: 'Pondère les avis des autres agents, prend la décision finale, gère les conflits.' },
  reporter: { n: '07', name: 'Reporter', role: 'Archive la décision', color: 'var(--ink-3)', desc: 'Génère une justification écrite en français pour chaque trade. Tout est auditable.' },
};

const AGENT_IDS = ['collector', 'analyst', 'bull', 'bear', 'risk', 'strategist', 'reporter'];

function Help({ tip }: { tip: string }) {
  return <span className="card-h-help" data-tip={tip}>i</span>;
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  idle: { label: 'en attente', color: 'var(--ink-4)' },
  running: { label: 'actif', color: 'var(--warn)' },
  ok: { label: 'actif', color: 'var(--accent)' },
  error: { label: 'erreur', color: 'var(--danger)' },
};

interface PredictionStats {
  total: number;
  resolved: number;
  correct: number;
  win_rate: number;
  by_direction: {
    BUY: { total: number; correct: number };
    SELL: { total: number; correct: number };
    HOLD: { total: number; correct: number };
  };
}

export function Agents() {
  const { agents, signals, debates, cycleTimeline, lastUpdate } = useSignalsStore();
  const { config } = useConfigStore();
  const [active, setActive] = useState('bull');
  const [perfStats, setPerfStats] = useState<PredictionStats | null>(null);

  useEffect(() => {
    const api = import.meta.env.VITE_API_URL || '/api';
    fetch(`${api}/portfolio/ai-performance`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setPerfStats(data);
      })
      .catch(() => {});
  }, []);

  const meta = AGENT_META[active] || AGENT_META.bull;
  const realAgent: AgentState = (agents as any)[active] || { status: 'idle' };
  const statusInfo = STATUS_MAP[realAgent.status] || STATUS_MAP.idle;

  // Find debates for active agent
  const agentDebates = debates.filter((d) => {
    if (active === 'bull') return d.bull;
    if (active === 'bear') return d.bear;
    return true;
  });

  // Latest signal for bull/bear/strategist
  const latestSignal = signals.length > 0 ? signals[0] : null;

  return (
    <div className="page">
      <div className="flex between center" style={{ marginBottom: 22 }}>
        <div>
          <h1 className="h1">Agents IA</h1>
          <div style={{ color: 'var(--ink-3)', fontSize: 13, marginTop: 6 }}>
            Chaque agent a une spécialité. Aucun n'agit seul.
          </div>
        </div>
      </div>

      {/* Cards grid */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        {AGENT_IDS.map((id) => {
          const m = AGENT_META[id];
          const real = (agents as any)[id] as AgentState | undefined;
          const isRunning = real?.status === 'running';
          const isOk = real?.status === 'ok';
          const isErr = real?.status === 'error';
          const st = STATUS_MAP[real?.status || 'idle'];
          return (
            <button
              key={id}
              onClick={() => setActive(id)}
              className="card"
              style={{
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: 'inherit',
                border: active === id ? `1px solid ${m.color}` : '1px solid var(--rule)',
                background: active === id ? 'var(--bg-elev-2)' : 'var(--bg-elev)',
                padding: 0,
              }}
            >
              <div style={{ padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>{m.n}</span>
                  <span style={{
                    padding: '2px 8px', borderRadius: 4, fontSize: 10, fontFamily: 'var(--mono)',
                    background: st.color + '22', color: st.color,
                    display: 'flex', alignItems: 'center', gap: 4,
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: st.color }} />
                    {st.label}
                  </span>
                </div>
                <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 2 }}>{m.name}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{m.role}</div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Detail */}
      <div className="grid" style={{ gridTemplateColumns: '1.4fr 1fr', gap: 12 }}>
        <div className="card">
          <div className="card-h">
            <div className="card-h-title">
              <span style={{ width: 10, height: 10, borderRadius: 50, background: meta.color }} />
              {meta.name} · <span style={{ fontWeight: 400, color: 'var(--ink-3)' }}>{meta.role}</span>
            </div>
            <span className="card-h-meta">agent {meta.n}</span>
          </div>
          <div style={{ padding: 24 }}>
            <p style={{ fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.6, marginBottom: 24 }}>{meta.desc}</p>

            {/* Real agent info */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
              <div style={{ background: 'var(--bg-elev-2)', padding: 16, borderRadius: 8 }}>
                <div className="kpi-label">Statut</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: statusInfo.color }}>{statusInfo.label}</div>
              </div>
              {realAgent.lastRun && (
                <div style={{ background: 'var(--bg-elev-2)', padding: 16, borderRadius: 8 }}>
                  <div className="kpi-label">Dernière exécution</div>
                  <div className="mono" style={{ fontSize: 14 }}>{new Date(realAgent.lastRun).toLocaleTimeString('fr-FR')}</div>
                </div>
              )}
              {realAgent.durationMs != null && (
                <div style={{ background: 'var(--bg-elev-2)', padding: 16, borderRadius: 8 }}>
                  <div className="kpi-label">Durée</div>
                  <div className="mono" style={{ fontSize: 14 }}>{(realAgent.durationMs / 1000).toFixed(1)}s</div>
                </div>
              )}
              {realAgent.tokensUsed != null && (
                <div style={{ background: 'var(--bg-elev-2)', padding: 16, borderRadius: 8 }}>
                  <div className="kpi-label">Tokens</div>
                  <div className="mono" style={{ fontSize: 14 }}>{realAgent.tokensUsed.toLocaleString()}</div>
                </div>
              )}
              {realAgent.error && (
                <div style={{ background: 'var(--bg-elev-2)', padding: 16, borderRadius: 8, gridColumn: '1 / -1' }}>
                  <div className="kpi-label">Erreur</div>
                  <div style={{ fontSize: 12, color: 'var(--danger)' }}>{realAgent.error}</div>
                </div>
              )}
            </div>

            {/* Real output from debates/signals */}
            <div style={{ padding: 16, background: 'var(--bg-elev-2)', borderRadius: 8, fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.7 }}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Dernière sortie</div>
              {agentDebates.length > 0 ? (
                agentDebates.slice(0, 2).map((d) => (
                  <div key={d.ticker} style={{ marginBottom: 8 }}>
                    <span style={{ fontWeight: 600 }}>{d.ticker}</span> — score {d.debate_score > 0 ? '+' : ''}{d.debate_score}
                    {active === 'bull' && d.bull && (
                      <span> · conviction {d.bull.conviction}/10{d.bull.technical_case ? ` · ${d.bull.technical_case.slice(0, 60)}` : ''}</span>
                    )}
                    {active === 'bear' && d.bear && (
                      <span> · conviction {d.bear.conviction}/10</span>
                    )}
                    {active === 'analyst' && d.analyst_output && (
                      <span> · confiance {d.analyst_output.confidence}%</span>
                    )}
                  </div>
                ))
              ) : signals.length > 0 && (active === 'bull' || active === 'bear' || active === 'strategist') ? (
                signals.slice(0, 3).map((s) => (
                  <div key={s.ticker} style={{ marginBottom: 8 }}>
                    <span style={{ fontWeight: 600 }}>{s.ticker}</span> — {s.signal} (score {s.debate_score > 0 ? '+' : ''}{s.debate_score}, confiance {s.confidence}%)
                    {s.reasoning ? ` · ${s.reasoning.slice(0, 80)}` : ''}
                  </div>
                ))
              ) : (
                <div style={{ color: 'var(--ink-4)' }}>Aucune sortie disponible — en attente du prochain cycle</div>
              )}
            </div>

            {/* Cycle timeline */}
            {cycleTimeline.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div className="eyebrow" style={{ marginBottom: 8 }}>Dernier cycle</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {cycleTimeline.slice(-7).map((ev, i) => {
                    const evMeta = AGENT_META[ev.agent];
                    return (
                      <div key={i} style={{
                        padding: '4px 10px', borderRadius: 4, fontSize: 10, fontFamily: 'var(--mono)',
                        background: (ev.status === 'ok' ? 'var(--accent-soft)' : ev.status === 'running' ? 'var(--warn-soft)' : 'var(--danger-soft)'),
                        color: ev.status === 'ok' ? 'var(--accent)' : ev.status === 'running' ? 'var(--warn)' : 'var(--danger)',
                      }}>
                        {evMeta?.name || ev.agent} {ev.status === 'ok' ? '✓' : ev.status === 'running' ? '⟳' : '✗'}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-h">
            <div className="card-h-title">
              Performance IA <Help tip="Win rate des prédictions des agents, basé sur les trades fermés." />
            </div>
          </div>
          <div style={{ padding: 20 }}>
            {perfStats && perfStats.total > 0 ? (
              <>
                {AGENT_IDS.filter((id) => ['bull', 'bear', 'strategist', 'analyst'].includes(id)).map((id) => {
                  const m = AGENT_META[id];
                  // Use real perf stats where available
                  const w = id === 'bull' ? (perfStats.by_direction.BUY.total > 0 ? Math.round((perfStats.by_direction.BUY.correct / perfStats.by_direction.BUY.total) * 100) : 0) :
                            id === 'bear' ? (perfStats.by_direction.SELL.total > 0 ? Math.round((perfStats.by_direction.SELL.correct / perfStats.by_direction.SELL.total) * 100) : 0) :
                            Math.round(perfStats.win_rate);
                  return (
                    <div key={id} style={{ marginBottom: 16 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontSize: 13 }}>{m.name}</span>
                        <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: m.color }}>{w}%</span>
                      </div>
                      <div style={{ height: 6, background: 'var(--bg-elev-2)', borderRadius: 999 }}>
                        <div style={{ width: `${w}%`, height: '100%', background: m.color, borderRadius: 999 }} />
                      </div>
                    </div>
                  );
                })}
                <hr style={{ border: 0, borderTop: '1px solid var(--rule)', margin: '20px 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ink-3)' }}>
                  <span>Prédictions totales</span>
                  <span className="mono" style={{ color: 'var(--ink)' }}>{perfStats.total}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }}>
                  <span>Résolues</span>
                  <span className="mono" style={{ color: 'var(--ink)' }}>{perfStats.resolved}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }}>
                  <span>Win rate global</span>
                  <span className="mono" style={{ color: 'var(--accent)' }}>{perfStats.win_rate.toFixed(1)}%</span>
                </div>
              </>
            ) : (
              <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
                Pas encore de données de performance — les statistiques apparaîtront avec les premiers trades
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}