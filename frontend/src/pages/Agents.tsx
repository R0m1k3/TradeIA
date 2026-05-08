import { useState, useEffect, useRef } from 'react';
import { useSignalsStore } from '../store/signals.store';
import { useConfigStore } from '../store/config.store';
import type { AgentState, DebateOutput, AnalysisEvent } from '../types';

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
const PERF_REFRESH_MS = 5 * 60 * 1000;

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

interface LiveAnalysisItem {
  id: string;
  timestamp: string;
  agent: string;
  title: string;
  summarySimple: string;
  summaryExpert: string;
  confidence?: number;
  ticker?: string;
  freshnessScore?: number;
}

function simplifySignal(signal: string): string {
  if (signal === 'BUY') return 'L IA veut acheter';
  if (signal === 'SELL') return 'L IA veut vendre';
  return 'L IA préfère attendre';
}

function buildDebateAnalysisItems(debates: DebateOutput[]): LiveAnalysisItem[] {
  return debates.flatMap((d, idx) => {
    const baseTs = new Date(Date.now() - (debates.length - idx) * 1000).toISOString();
    return [
      {
        id: `${d.ticker}-analyst-${idx}`,
        timestamp: baseTs,
        agent: 'analyst',
        title: `${d.ticker} - lecture technique`,
        summarySimple: `Confiance ${d.analyst_output.confidence}% sur ${d.ticker}.`,
        summaryExpert: `Bias 4H/1H: ${d.analyst_output.bias_4h}/${d.analyst_output.bias_1h}, signal 15m ${d.analyst_output.signal_15m}, RSI15 ${d.analyst_output.rsi_15m}.`,
        confidence: d.analyst_output.confidence,
        ticker: d.ticker,
        freshnessScore: d.analyst_output.data_freshness_score,
      },
      {
        id: `${d.ticker}-debate-${idx}`,
        timestamp: new Date(new Date(baseTs).getTime() + 200).toISOString(),
        agent: 'strategist',
        title: `${d.ticker} - débat bull vs bear`,
        summarySimple: d.debate_score > 0
          ? `Avantage haussier sur ${d.ticker}.`
          : d.debate_score < 0
            ? `Avantage baissier sur ${d.ticker}.`
            : `Les avis sont partagés sur ${d.ticker}.`,
        summaryExpert: `Debate score ${d.debate_score}, bull ${d.bull.conviction}/10, bear ${d.bear.conviction}/10.`,
        confidence: d.analyst_output.confidence,
        ticker: d.ticker,
        freshnessScore: d.analyst_output.data_freshness_score,
      },
    ];
  });
}

export function Agents() {
  const { agents, signals, debates, cycleTimeline, analysisEvents, lastUpdate } = useSignalsStore();
  const { config } = useConfigStore();
  const [active, setActive] = useState('bull');
  const [perfStats, setPerfStats] = useState<PredictionStats | null>(null);
  const [readingMode, setReadingMode] = useState<'beginner' | 'expert'>('beginner');
  const [selectedItem, setSelectedItem] = useState<LiveAnalysisItem | null>(null);
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
  }, [lastUpdate]);

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
  const fallbackItems: LiveAnalysisItem[] = [
    ...cycleTimeline.slice(-10).map((ev, i) => ({
      id: `timeline-${i}-${ev.agent}-${ev.timestamp}`,
      timestamp: ev.timestamp,
      agent: ev.agent,
      title: AGENT_META[ev.agent]?.name || ev.agent,
      summarySimple: ev.status === 'running'
        ? `${AGENT_META[ev.agent]?.name || ev.agent} est en train d analyser.`
        : ev.status === 'ok'
          ? `${AGENT_META[ev.agent]?.name || ev.agent} a terminé son étape.`
          : `${AGENT_META[ev.agent]?.name || ev.agent} a rencontré un problème.`,
      summaryExpert: `${ev.label} - statut: ${ev.status}`,
    })),
    ...buildDebateAnalysisItems(debates.slice(0, 4)),
    ...signals.slice(0, 4).map((s, i) => ({
      id: `signal-${s.ticker}-${i}`,
      timestamp: new Date(Date.now() - i * 400).toISOString(),
      agent: 'strategist',
      title: `${s.ticker} - décision`,
      summarySimple: `${simplifySignal(s.signal)} avec confiance ${s.confidence}%.`,
      summaryExpert: `Signal ${s.signal}, débat ${s.debate_score}, bull ${s.bull_conviction}, bear ${s.bear_conviction}.`,
      confidence: s.confidence,
      ticker: s.ticker,
    })),
  ];

  const backendItems: LiveAnalysisItem[] = (analysisEvents || []).map((item: AnalysisEvent) => ({
    id: item.id,
    timestamp: item.timestamp,
    agent: item.agent,
    title: item.title,
    summarySimple: item.summary_simple,
    summaryExpert: item.summary_expert,
    confidence: item.confidence,
    ticker: item.ticker,
    freshnessScore: item.freshness_score,
  }));

  const timelineItems: LiveAnalysisItem[] = (backendItems.length > 0 ? backendItems : fallbackItems)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 20);

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

            <div style={{ marginTop: 20, borderTop: '1px solid var(--rule)', paddingTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div className="card-h-title" style={{ padding: 0, border: 'none' }}>
                  Journal d analyses live <Help tip="Clique une ligne pour ouvrir le détail de ce que l agent a vu, conclu, et avec quel niveau de confiance." />
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setReadingMode('beginner')}
                    style={{ borderColor: readingMode === 'beginner' ? 'var(--accent)' : undefined, color: readingMode === 'beginner' ? 'var(--accent)' : undefined }}
                  >
                    Débutant
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setReadingMode('expert')}
                    style={{ borderColor: readingMode === 'expert' ? 'var(--accent)' : undefined, color: readingMode === 'expert' ? 'var(--accent)' : undefined }}
                  >
                    Expert
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflow: 'auto', paddingRight: 4 }}>
                {timelineItems.length === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--ink-3)', padding: 8 }}>
                    Le journal se remplit automatiquement au fur et à mesure du cycle.
                  </div>
                )}
                {timelineItems.map((item) => {
                  const meta = AGENT_META[item.agent] || AGENT_META.reporter;
                  const activeItem = selectedItem?.id === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setSelectedItem(item)}
                      style={{
                        textAlign: 'left',
                        border: `1px solid ${activeItem ? meta.color : 'var(--rule)'}`,
                        background: activeItem ? 'var(--bg-elev-2)' : 'transparent',
                        borderRadius: 8,
                        padding: '10px 12px',
                        cursor: 'pointer',
                        color: 'inherit',
                        fontFamily: 'inherit',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>{item.title}</div>
                        <div className="mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>
                          {new Date(item.timestamp).toLocaleTimeString('fr-FR')}
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.45 }}>
                        {readingMode === 'beginner' ? item.summarySimple : item.summaryExpert}
                      </div>
                      {(item.confidence != null || item.freshnessScore != null) && (
                        <div style={{ display: 'flex', gap: 10, marginTop: 8, fontSize: 10 }} className="mono">
                          {item.confidence != null && <span style={{ color: 'var(--accent)' }}>Confiance {item.confidence}%</span>}
                          {item.freshnessScore != null && <span style={{ color: item.freshnessScore >= 70 ? 'var(--accent)' : item.freshnessScore >= 50 ? 'var(--warn)' : 'var(--danger)' }}>Fraîcheur {item.freshnessScore}/100</span>}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
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

      {/* AI Logs card */}
      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-h">
          <div className="card-h-title">
            Logs IA <Help tip="Journaux complets de chaque cycle IA : analyse, débats, propositions, rejections risk. Max 3 jours." />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm btn-ghost" onClick={fetchAiLogs} disabled={logsLoading}>
              {logsLoading ? '...' : 'Rafraîchir'}
            </button>
            {aiLogs.length > 0 && (
              <>
                <button className="btn btn-sm" onClick={downloadAllLogs}>
                  ↓ Tout télécharger
                </button>
                <button
                  className="btn btn-sm"
                  style={{ color: deleteConfirm ? 'var(--danger)' : undefined, borderColor: deleteConfirm ? 'var(--danger)' : undefined }}
                  onClick={deleteAllLogs}
                  onBlur={() => setDeleteConfirm(false)}
                >
                  {deleteConfirm ? 'Confirmer suppression' : 'Tout supprimer'}
                </button>
              </>
            )}
          </div>
        </div>
        <div style={{ padding: '0 20px 20px' }}>
          {aiLogs.length === 0 ? (
            <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
              Aucun log disponible — les logs apparaissent après le premier cycle IA complet
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ color: 'var(--ink-3)', borderBottom: '1px solid var(--rule)' }}>
                  <th style={{ textAlign: 'left', padding: '8px 0', fontWeight: 500 }}>Date</th>
                  <th style={{ textAlign: 'right', padding: '8px 4px', fontWeight: 500 }}>Tickers</th>
                  <th style={{ textAlign: 'right', padding: '8px 4px', fontWeight: 500 }}>Propositions</th>
                  <th style={{ textAlign: 'right', padding: '8px 4px', fontWeight: 500 }}>Rejections</th>
                  <th style={{ textAlign: 'right', padding: '8px 4px', fontWeight: 500 }}>Exécutés</th>
                  <th style={{ textAlign: 'right', padding: '8px 4px', fontWeight: 500 }}>Durée</th>
                  <th style={{ textAlign: 'right', padding: '8px 0', fontWeight: 500 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {aiLogs.map((log) => (
                  <tr key={log.id} style={{ borderBottom: '1px solid var(--rule)' }}>
                    <td style={{ padding: '8px 0', color: 'var(--ink)' }}>
                      {new Date(log.createdAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                    <td className="mono" style={{ textAlign: 'right', padding: '8px 4px' }}>{log.tickersCount}</td>
                    <td className="mono" style={{ textAlign: 'right', padding: '8px 4px' }}>{log.proposalsCount}</td>
                    <td className="mono" style={{ textAlign: 'right', padding: '8px 4px', color: log.rejectionsCount > 0 ? 'var(--warn)' : undefined }}>
                      {log.rejectionsCount}
                    </td>
                    <td className="mono" style={{ textAlign: 'right', padding: '8px 4px', color: log.executedCount > 0 ? 'var(--accent)' : 'var(--ink-3)' }}>
                      {log.executedCount}
                    </td>
                    <td className="mono" style={{ textAlign: 'right', padding: '8px 4px', color: 'var(--ink-3)' }}>
                      {log.durationMs > 60000 ? `${Math.round(log.durationMs / 60000)}m` : `${Math.round(log.durationMs / 1000)}s`}
                    </td>
                    <td style={{ textAlign: 'right', padding: '8px 0' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button className="btn btn-sm btn-ghost" onClick={() => downloadLog(log.id)}>↓</button>
                        <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => deleteLog(log.id)}>×</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {selectedItem && (
        <div
          onClick={() => setSelectedItem(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'grid',
            justifyItems: 'end', zIndex: 80,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(520px, 100vw)', height: '100%', background: 'var(--bg-elev)',
              borderLeft: '1px solid var(--rule)', padding: 18, overflow: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div>
                <div className="eyebrow">Détail analyse</div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>{selectedItem.title}</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setSelectedItem(null)}>Fermer</button>
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <span className="badge">{AGENT_META[selectedItem.agent]?.name || selectedItem.agent}</span>
              {selectedItem.ticker && <span className="badge">{selectedItem.ticker}</span>}
              {selectedItem.confidence != null && <span className="badge badge-up">Confiance {selectedItem.confidence}%</span>}
              {selectedItem.freshnessScore != null && (
                <span className={`badge ${selectedItem.freshnessScore >= 70 ? 'badge-up' : selectedItem.freshnessScore >= 50 ? 'badge-warn' : 'badge-down'}`}>
                  Fraîcheur {selectedItem.freshnessScore}/100
                </span>
              )}
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              <div className="card" style={{ padding: 12 }}>
                <div className="eyebrow" style={{ marginBottom: 6 }}>Version simple</div>
                <div style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.55 }}>{selectedItem.summarySimple}</div>
              </div>
              <div className="card" style={{ padding: 12 }}>
                <div className="eyebrow" style={{ marginBottom: 6 }}>Version détaillée</div>
                <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55 }}>{selectedItem.summaryExpert}</div>
              </div>
              <div className="card" style={{ padding: 12 }}>
                <div className="eyebrow" style={{ marginBottom: 6 }}>Conseil lecture</div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.55 }}>
                  Si la fraîcheur est basse ou la confiance est faible, la décision doit être prise avec prudence ou reportée.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
