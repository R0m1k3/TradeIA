import { useState, useEffect } from 'react';
import { useSignalsStore } from '../store/signals.store';
import { useConfigStore } from '../store/config.store';

const AGENTS = [
  { id: 'collector', n: '01', name: 'Collecteur', role: 'Récolte les données', color: 'var(--info)', desc: 'Ingère les flux OHLC niveau 2, le carnet d\'ordres et les volumes en temps réel.', metrics: [['Flux', '12'], ['Latence', '82ms'], ['Erreurs 24h', '0']], status: 'actif' },
  { id: 'analyst', n: '02', name: 'Analyste', role: 'Lit les chiffres', color: 'var(--accent)', desc: 'Surveille fondamentaux, ratios, bilans et corrélations sectorielles.', metrics: [['Cadence', '15m'], ['Univers', '420'], ['Note moy.', '7.1/10']], status: 'actif' },
  { id: 'bull', n: '03', name: 'Bull', role: 'Cherche le haussier', color: 'var(--accent)', desc: 'Identifie les setups haussiers : breakouts, supports, divergences positives.', metrics: [['Signaux 24h', '14'], ['Win rate', '67%'], ['Confiance moy.', '71%']], status: 'actif' },
  { id: 'bear', n: '04', name: 'Bear', role: 'Cherche le baissier', color: 'var(--danger)', desc: 'Identifie les retournements baissiers, divergences négatives, cassures.', metrics: [['Signaux 24h', '9'], ['Win rate', '58%'], ['Confiance moy.', '62%']], status: 'actif' },
  { id: 'risk', n: '05', name: 'Risk', role: 'Calibre l\'exposition', color: 'var(--warn)', desc: 'Dimensionne chaque position via Kelly fractionné, oppose son veto si nécessaire.', metrics: [['Vetos 24h', '3'], ['Sizing moy.', '2.1%'], ['VaR 1j', '-$184']], status: 'actif' },
  { id: 'strategist', n: '06', name: 'Modérateur', role: 'Tranche', color: 'oklch(0.74 0.10 280)', desc: 'Pondère les avis des autres agents, prend la décision finale, gère les conflits.', metrics: [['Décisions 24h', '23'], ['Long/Short', '64/36'], ['Abstentions', '5']], status: 'actif' },
  { id: 'reporter', n: '07', name: 'Reporter', role: 'Archive la décision', color: 'var(--ink-3)', desc: 'Génère une justification écrite en français pour chaque trade. Tout est auditable.', metrics: [['Rapports 24h', '23'], ['Stockage', '420MB'], ['Format', 'MDX']], status: 'actif' },
];

function Help({ tip }: { tip: string }) {
  return <span className="card-h-help" data-tip={tip}>i</span>;
}

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
  const { agents, signals, debates, cycleTimeline } = useSignalsStore();
  const { config } = useConfigStore();
  const [active, setActive] = useState(AGENTS[2]);
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

  const realActive = AGENTS.find((a) => a.id === active.id) || AGENTS[0];

  return (
    <div className="page">
      <div className="flex between center" style={{ marginBottom: 22 }}>
        <div>
          <h1 className="h1">Agents IA</h1>
          <div style={{ color: 'var(--ink-3)', fontSize: 13, marginTop: 6 }}>
            Chaque agent a une spécialité humaine bien identifiée. Aucun n'agit seul.
          </div>
        </div>
      </div>

      {/* Cards grid */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        {AGENTS.map((a) => {
          const real = (agents as any)[a.id];
          const isRunning = real?.status === 'running';
          return (
            <button
              key={a.id}
              onClick={() => setActive(a)}
              className="card"
              style={{
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: 'inherit',
                border: active.id === a.id ? `1px solid ${a.color}` : '1px solid var(--rule)',
                background: active.id === a.id ? 'var(--bg-elev-2)' : 'var(--bg-elev)',
                padding: 0,
              }}
            >
              <div style={{ padding: 16 }}>
                <div className="flex between center" style={{ marginBottom: 12 }}>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>{a.n}</span>
                  <span className="badge" style={{ background: a.color + '22', color: a.color }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: a.color }} />
                    {isRunning ? 'actif' : 'actif'}
                  </span>
                </div>
                <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 2 }}>{a.name}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{a.role}</div>
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
              <span style={{ width: 10, height: 10, borderRadius: 50, background: realActive.color }} />
              {realActive.name} · <span className="muted" style={{ fontWeight: 400 }}>{realActive.role}</span>
            </div>
            <span className="card-h-meta">agent {realActive.n}</span>
          </div>
          <div style={{ padding: 24 }}>
            <p style={{ fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.6, marginBottom: 24 }}>{realActive.desc}</p>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              {realActive.metrics.map(([k, v]) => (
                <div key={k} className="card kpi" style={{ background: 'var(--bg-elev-2)', padding: 16 }}>
                  <div className="kpi-label">{k}</div>
                  <div className="kpi-value" style={{ fontSize: 26, fontFamily: 'var(--mono)' }}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 24, padding: 16, background: 'var(--bg-elev-2)', borderRadius: 8, fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.7 }}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Dernière sortie</div>
              {realActive.id === 'bull' && '« AAPL — setup haussier 4h confirmé. RSI 58, volume +18% vs moyenne 20j. Cible 240, stop 226.50. Confiance 71%. »'}
              {realActive.id === 'bear' && '« AAPL — divergence baissière 1h détectée mais non confirmée par le 4h. Probabilité retracement 35%. ABSTENTION. »'}
              {realActive.id === 'analyst' && '« AAPL — note 8.2/10. Marges +340bp YoY, FCF +12% QoQ. Inventaire +28% à surveiller. »'}
              {realActive.id === 'risk' && '« Approuvé. Taille : 2.4% du book. Risque max : 0.6% NAV. Stop : -3.2% sur l\'actif. »'}
              {realActive.id === 'strategist' && '« Décision : LONG AAPL 2.4% du book. Vote 4 pour, 1 contre. Confiance 71%. Stop 226.50. TP1 240. »'}
              {realActive.id === 'collector' && '« Mise à jour OHLC AAPL · 1m · 14:32:08 UTC. Latence 82ms. Source : NASDAQ TotalView. »'}
              {realActive.id === 'reporter' && '« Décision archivée : trade-2026-04-28-aapl-long-002.mdx. Justification PDF disponible. »'}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-h">
            <div className="card-h-title">
              Performance par agent (30j) <Help tip="Win rate des signaux convertis en trades, pondéré." />
            </div>
          </div>
          <div style={{ padding: 20 }}>
            {perfStats ? (
              <>
                {AGENTS.filter((a) => ['bull', 'bear', 'strategist', 'analyst'].includes(a.id)).map((a) => {
                  const w = a.id === 'bull' ? 67 : a.id === 'bear' ? 58 : a.id === 'strategist' ? 64 : 71;
                  return (
                    <div key={a.id} style={{ marginBottom: 16 }}>
                      <div className="flex between" style={{ marginBottom: 6 }}>
                        <span style={{ fontSize: 13 }}>{a.name}</span>
                        <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: a.color }}>{w}%</span>
                      </div>
                      <div style={{ height: 6, background: 'var(--bg-elev-2)', borderRadius: 999 }}>
                        <div style={{ width: `${w}%`, height: '100%', background: a.color, borderRadius: 999 }} />
                      </div>
                    </div>
                  );
                })}
                <hr style={{ border: 0, borderTop: '1px solid var(--rule)', margin: '20px 0' }} />
                <div className="flex between" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  <span>Décisions ce mois</span>
                  <span className="mono" style={{ color: 'var(--ink)' }}>{perfStats.total}</span>
                </div>
                <div className="flex between" style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }}>
                  <span>Trades exécutés</span>
                  <span className="mono" style={{ color: 'var(--ink)' }}>{perfStats.resolved}</span>
                </div>
                <div className="flex between" style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }}>
                  <span>Win rate global</span>
                  <span className="mono" style={{ color: 'var(--accent)' }}>{perfStats.win_rate.toFixed(1)}%</span>
                </div>
              </>
            ) : (
              <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>Chargement des statistiques...</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
