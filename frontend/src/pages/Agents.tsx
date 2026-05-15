import { useState, useEffect, useRef } from 'react';
import { useSignalsStore } from '../store/signals.store';
import type { AgentState } from '../types';
import { DecisionViewer } from '../components/agents/DecisionViewer';

/**
 * Nouvelle architecture pipeline:
 *   1. Collecteur (déterministe)  — récolte OHLCV + news + macro
 *   2. Analyste    (déterministe)  — calcule indicateurs RSI/MACD/EMA/ATR/ADX
 *   3. DECIDEUR LLM (réflexion)    — UNIQUE étape AI: choisit BUY/SELL/HOLD pour chaque ticker
 *   4. Risk        (déterministe)  — valide R/R, vol cap, Kelly, sector, cash
 *   5. Broker      (déterministe)  — exécute les ordres approuvés
 *
 * Le LLM ne fait QUE choisir. Tout le reste est calcul/validation.
 */

interface StageMeta {
  n: string;
  name: string;
  role: string;
  color: string;
  isLLM: boolean;
  desc: string;
  agentKey?: string; // pour mapper sur agents state
}

const STAGES: StageMeta[] = [
  {
    n: '01',
    name: 'Collecteur',
    role: 'Récolte les données brutes',
    color: 'var(--info)',
    isLLM: false,
    desc: 'Récupère OHLCV (15m/1h/4h), fondamentaux, news, macro (VIX, F&G, FOMC). Aucun LLM — pure ingestion de données.',
    agentKey: 'collector',
  },
  {
    n: '02',
    name: 'Analyste',
    role: 'Calcule les indicateurs',
    color: 'var(--accent)',
    isLLM: false,
    desc: 'Calcule RSI, MACD, EMA, ATR, ADX, Bollinger, divergences, niveaux S/R. Pénalités appliquées (surachat, volume faible). Tout est déterministe.',
    agentKey: 'analyst',
  },
  {
    n: '03',
    name: 'Décideur LLM',
    role: 'Réfléchit et choisit',
    color: 'oklch(0.74 0.10 280)',
    isLLM: true,
    desc: 'UNIQUE étape de réflexion AI. Reçoit indicateurs + news + macro + portfolio + calibration historique. Pour chaque ticker, choisit BUY, SELL ou HOLD avec taille, stops, et reasoning complet en français.',
    agentKey: 'strategist',
  },
  {
    n: '04',
    name: 'Risk',
    role: 'Valide les chiffres',
    color: 'var(--warn)',
    isLLM: false,
    desc: 'Validation chiffrée: R/R ≥ 1.8, Kelly half-fraction, vol targeting 4%/slot, cap secteur 40% NAV, max 5 positions/secteur, cash budget. Refuse ou réduit la taille si nécessaire.',
    agentKey: 'risk',
  },
  {
    n: '05',
    name: 'Broker',
    role: 'Exécute les ordres',
    color: 'var(--ink-3)',
    isLLM: false,
    desc: 'Exécute en mock (ou réel) avec slippage market-cap-aware et commission 0.1%. Trailing stops automatiques (BE à +1.5R, chandelier à +3R).',
    agentKey: 'reporter',
  },
];

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

const PERF_REFRESH_MS = 5 * 60 * 1000;

function Help({ tip }: { tip: string }) {
  return <span className="card-h-help" data-tip={tip}>i</span>;
}

export function Agents() {
  const { agents, lastUpdate, cycleTimeline } = useSignalsStore();
  const [activeStage, setActiveStage] = useState<string>('Décideur LLM');
  const [perfStats, setPerfStats] = useState<PredictionStats | null>(null);
  const lastPerfFetchRef = useRef(0);

  const api = import.meta.env.VITE_API_URL || '/api';

  useEffect(() => {
    const now = Date.now();
    if (lastPerfFetchRef.current && now - lastPerfFetchRef.current < PERF_REFRESH_MS) return;
    lastPerfFetchRef.current = now;
    fetch(`${api}/portfolio/ai-performance`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setPerfStats(data);
      })
      .catch(() => {});
  }, [lastUpdate, api]);

  const meta = STAGES.find((s) => s.name === activeStage) ?? STAGES[2];
  const agentState: AgentState | undefined = meta.agentKey ? (agents as any)[meta.agentKey] : undefined;
  const statusInfo = STATUS_MAP[agentState?.status || 'idle'];

  return (
    <div className="page">
      <div className="flex between center" style={{ marginBottom: 22 }}>
        <div>
          <h1 className="h1">Pipeline de décision</h1>
          <div style={{ color: 'var(--ink-3)', fontSize: 13, marginTop: 6 }}>
            5 étapes — une seule fait réfléchir le LLM. Le reste est du calcul.
          </div>
        </div>
      </div>

      {/* Pipeline flow visualization */}
      <div className="card" style={{ marginBottom: 16, padding: 18 }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Flux du cycle</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, alignItems: 'stretch' }}>
          {STAGES.map((s, idx) => {
            const isActive = activeStage === s.name;
            const real = s.agentKey ? (agents as any)[s.agentKey] as AgentState | undefined : undefined;
            const st = STATUS_MAP[real?.status || 'idle'];
            return (
              <button
                key={s.name}
                onClick={() => setActiveStage(s.name)}
                style={{
                  position: 'relative',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  background: isActive ? 'var(--bg-elev-2)' : 'var(--bg-elev)',
                  border: `1px solid ${isActive ? s.color : 'var(--rule)'}`,
                  borderRadius: 8,
                  padding: 14,
                  color: 'inherit',
                }}
              >
                {idx < STAGES.length - 1 && (
                  <span style={{
                    position: 'absolute', right: -8, top: '50%', transform: 'translateY(-50%)',
                    fontSize: 16, color: 'var(--ink-4)', zIndex: 1,
                  }}>›</span>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>{s.n}</span>
                  <span style={{
                    padding: '2px 6px', borderRadius: 4, fontSize: 9, fontFamily: 'var(--mono)',
                    background: st.color + '22', color: st.color, display: 'flex', alignItems: 'center', gap: 4,
                  }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: st.color }} />
                    {st.label}
                  </span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 3, color: isActive ? s.color : 'inherit' }}>
                  {s.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 6 }}>{s.role}</div>
                <div style={{
                  display: 'inline-block', padding: '1px 6px', borderRadius: 3, fontSize: 9,
                  background: s.isLLM ? 'oklch(0.74 0.10 280 / 0.2)' : 'var(--bg-elev-2)',
                  color: s.isLLM ? 'oklch(0.74 0.10 280)' : 'var(--ink-4)',
                  fontFamily: 'var(--mono)', fontWeight: 600,
                }}>
                  {s.isLLM ? '⚡ LLM' : 'Code'}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Decisions viewer = vue principale */}
      <DecisionViewer apiBase={api} refreshKey={lastUpdate} />

      {/* Bottom: étape sélectionnée + perfs */}
      <div className="grid" style={{ gridTemplateColumns: '1.4fr 1fr', gap: 12, marginTop: 12 }}>
        <div className="card">
          <div className="card-h">
            <div className="card-h-title">
              <span style={{ width: 10, height: 10, borderRadius: 50, background: meta.color }} />
              {meta.name} · <span style={{ fontWeight: 400, color: 'var(--ink-3)' }}>{meta.role}</span>
            </div>
            <span className="card-h-meta">
              {meta.isLLM ? '⚡ LLM' : 'Déterministe'} · étape {meta.n}
            </span>
          </div>
          <div style={{ padding: 20 }}>
            <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.6, marginBottom: 18 }}>
              {meta.desc}
            </p>

            {agentState && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
                <div style={{ background: 'var(--bg-elev-2)', padding: 12, borderRadius: 6 }}>
                  <div className="eyebrow">Statut</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: statusInfo.color }}>{statusInfo.label}</div>
                </div>
                {agentState.lastRun && (
                  <div style={{ background: 'var(--bg-elev-2)', padding: 12, borderRadius: 6 }}>
                    <div className="eyebrow">Dernière exécution</div>
                    <div className="mono" style={{ fontSize: 12 }}>{new Date(agentState.lastRun).toLocaleTimeString('fr-FR')}</div>
                  </div>
                )}
                {agentState.durationMs != null && (
                  <div style={{ background: 'var(--bg-elev-2)', padding: 12, borderRadius: 6 }}>
                    <div className="eyebrow">Durée</div>
                    <div className="mono" style={{ fontSize: 12 }}>{(agentState.durationMs / 1000).toFixed(1)}s</div>
                  </div>
                )}
                {agentState.tokensUsed != null && (
                  <div style={{ background: 'var(--bg-elev-2)', padding: 12, borderRadius: 6 }}>
                    <div className="eyebrow">Tokens</div>
                    <div className="mono" style={{ fontSize: 12 }}>{agentState.tokensUsed.toLocaleString()}</div>
                  </div>
                )}
                {agentState.error && (
                  <div style={{ background: 'var(--bg-elev-2)', padding: 12, borderRadius: 6, gridColumn: '1 / -1' }}>
                    <div className="eyebrow">Erreur</div>
                    <div style={{ fontSize: 11, color: 'var(--danger)' }}>{agentState.error}</div>
                  </div>
                )}
              </div>
            )}

            {/* Cycle timeline */}
            {cycleTimeline.length > 0 && (
              <div>
                <div className="eyebrow" style={{ marginBottom: 8 }}>Dernier cycle</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {cycleTimeline.slice(-7).map((ev, i) => (
                    <div key={i} style={{
                      padding: '4px 10px', borderRadius: 4, fontSize: 10, fontFamily: 'var(--mono)',
                      background: (ev.status === 'ok' ? 'var(--accent-soft, rgba(34,197,94,0.15))' : ev.status === 'running' ? 'var(--warn-soft, rgba(245,158,11,0.15))' : 'var(--danger-soft, rgba(239,68,68,0.15))'),
                      color: ev.status === 'ok' ? 'var(--accent)' : ev.status === 'running' ? 'var(--warn)' : 'var(--danger)',
                    }}>
                      {ev.label} {ev.status === 'ok' ? '✓' : ev.status === 'running' ? '⟳' : '✗'}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-h">
            <div className="card-h-title">
              Performance LLM <Help tip="Win rate des décisions du Décideur LLM, basé sur les prédictions résolues 5j après." />
            </div>
          </div>
          <div style={{ padding: 18 }}>
            {perfStats && perfStats.total > 0 ? (
              <>
                <div style={{ marginBottom: 14 }}>
                  <div className="eyebrow" style={{ marginBottom: 4 }}>Win rate global</div>
                  <div className="mono" style={{ fontSize: 28, fontWeight: 700, color: 'var(--accent)' }}>
                    {perfStats.win_rate.toFixed(1)}<span style={{ fontSize: 14, color: 'var(--ink-3)' }}>%</span>
                  </div>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}>
                    <span style={{ color: 'var(--accent)' }}>BUY</span>
                    <span className="mono" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                      {perfStats.by_direction.BUY.total > 0
                        ? Math.round((perfStats.by_direction.BUY.correct / perfStats.by_direction.BUY.total) * 100)
                        : 0}%
                      <span style={{ color: 'var(--ink-4)', marginLeft: 4 }}>({perfStats.by_direction.BUY.total})</span>
                    </span>
                  </div>
                  <div style={{ height: 5, background: 'var(--bg-elev-2)', borderRadius: 999 }}>
                    <div style={{
                      width: `${perfStats.by_direction.BUY.total > 0 ? (perfStats.by_direction.BUY.correct / perfStats.by_direction.BUY.total) * 100 : 0}%`,
                      height: '100%', background: 'var(--accent)', borderRadius: 999,
                    }} />
                  </div>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}>
                    <span style={{ color: 'var(--danger)' }}>SELL</span>
                    <span className="mono" style={{ color: 'var(--danger)', fontWeight: 600 }}>
                      {perfStats.by_direction.SELL.total > 0
                        ? Math.round((perfStats.by_direction.SELL.correct / perfStats.by_direction.SELL.total) * 100)
                        : 0}%
                      <span style={{ color: 'var(--ink-4)', marginLeft: 4 }}>({perfStats.by_direction.SELL.total})</span>
                    </span>
                  </div>
                  <div style={{ height: 5, background: 'var(--bg-elev-2)', borderRadius: 999 }}>
                    <div style={{
                      width: `${perfStats.by_direction.SELL.total > 0 ? (perfStats.by_direction.SELL.correct / perfStats.by_direction.SELL.total) * 100 : 0}%`,
                      height: '100%', background: 'var(--danger)', borderRadius: 999,
                    }} />
                  </div>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}>
                    <span style={{ color: 'var(--ink-3)' }}>HOLD</span>
                    <span className="mono" style={{ color: 'var(--ink-3)', fontWeight: 600 }}>
                      {perfStats.by_direction.HOLD.total > 0
                        ? Math.round((perfStats.by_direction.HOLD.correct / perfStats.by_direction.HOLD.total) * 100)
                        : 0}%
                      <span style={{ color: 'var(--ink-4)', marginLeft: 4 }}>({perfStats.by_direction.HOLD.total})</span>
                    </span>
                  </div>
                  <div style={{ height: 5, background: 'var(--bg-elev-2)', borderRadius: 999 }}>
                    <div style={{
                      width: `${perfStats.by_direction.HOLD.total > 0 ? (perfStats.by_direction.HOLD.correct / perfStats.by_direction.HOLD.total) * 100 : 0}%`,
                      height: '100%', background: 'var(--ink-3)', borderRadius: 999,
                    }} />
                  </div>
                </div>

                <hr style={{ border: 0, borderTop: '1px solid var(--rule)', margin: '16px 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ink-3)' }}>
                  <span>Prédictions totales</span>
                  <span className="mono" style={{ color: 'var(--ink)' }}>{perfStats.total}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ink-3)', marginTop: 6 }}>
                  <span>Résolues (5j+)</span>
                  <span className="mono" style={{ color: 'var(--ink)' }}>{perfStats.resolved}</span>
                </div>
              </>
            ) : (
              <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
                Les statistiques apparaîtront après les premières prédictions résolues (5 jours).
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
