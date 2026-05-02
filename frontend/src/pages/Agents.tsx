import { useState, useEffect } from 'react';
import { useSignalsStore } from '../store/signals.store';
import { useConfigStore } from '../store/config.store';
import { AgentStatusCard } from '../components/agents/AgentStatus';
import { ReasoningLog } from '../components/agents/ReasoningLog';
import { DebateViewer } from '../components/agents/DebateViewer';
import type { AgentStates } from '../types';

const MODEL_TIERS: Record<keyof AgentStates, 'LIGHT' | 'MID' | 'STRONG'> = {
  collector: 'LIGHT',
  analyst: 'MID',
  bull: 'MID',
  bear: 'MID',
  strategist: 'STRONG',
  risk: 'STRONG',
  reporter: 'LIGHT',
};

const AGENT_DESC: Record<string, string> = {
  collector: 'Collecte OHLCV, news, options, sentiment pour chaque ticker de la watchlist',
  analyst: 'Analyse multi-timeframe : biais 4H, timing 1H, signal 15m. Calcule indicateurs RSI, MACD, ATR, EMA.',
  bull: 'Argumente le cas haussier : upside %, catalyseurs techniques & fondamentaux, réfutation des bear',
  bear: 'Argumente le cas baissier : downside %, faiblesses structurelles, risques macro',
  strategist: 'Synthétise le débat → propose ordres (prix, stop, TP, sizing) en tenant compte du portefeuille',
  risk: 'Valide chaque ordre : R/R ≥ 2.0, VIX, perte journalière, concentration sectorielle, Expected Move IV30',
  reporter: 'Génère alertes en français, logs le cycle, sauvegarde prédictions pour feedback loop',
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
  const { agents, signals, debates, cycleTimeline } = useSignalsStore();
  const { config } = useConfigStore();
  const [selectedDebateTicker, setSelectedDebateTicker] = useState<string | null>(null);
  const [perfStats, setPerfStats] = useState<PredictionStats | null>(null);

  const modelMap: Record<string, string> = {
    LIGHT: config.model_light || 'anthropic/claude-haiku-4-5',
    MID: config.model_mid || 'anthropic/claude-sonnet-4-5',
    STRONG: config.model_strong || 'anthropic/claude-opus-4',
  };

  const selectedDebate = debates.find((d) => d.ticker === selectedDebateTicker) || debates[0];

  // Charger stats de performance IA
  useEffect(() => {
    const api = import.meta.env.VITE_API_URL || '/api';
    fetch(`${api}/portfolio/ai-performance`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setPerfStats(data); })
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-4 max-w-[1600px]">
      {/* Titre + explication */}
      <div>
        <h2 className="font-syne font-bold text-base text-text-primary mb-1">Pipeline Agents IA</h2>
        <p className="text-[11px] text-text-secondary">
          7 agents IA s'exécutent en séquence toutes les 5 minutes. Chaque agent a un rôle précis et passe ses résultats au suivant.
        </p>
      </div>

      {/* Agent status grid avec description */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {(Object.entries(agents) as [keyof AgentStates, AgentStates[keyof AgentStates]][]).map(([name, state]) => (
          <div key={name} className="space-y-1">
            <AgentStatusCard
              name={name}
              state={state}
              model={modelMap[MODEL_TIERS[name]]}
            />
            <p className="text-[9px] text-text-secondary px-1 leading-tight">
              {AGENT_DESC[name]}
            </p>
          </div>
        ))}
      </div>

      {/* Performance IA */}
      {perfStats && (
        <div className="bg-bg-surface rounded-lg border border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-syne font-bold text-sm text-text-primary">Performance des Prédictions IA</h3>
            <span className="text-[10px] text-text-secondary">{perfStats.resolved} prédictions résolues sur {perfStats.total}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-bg-elevated rounded p-3 text-center">
              <p className="text-[9px] text-text-secondary uppercase mb-1">Taux de réussite global</p>
              <p className={`font-syne font-bold text-2xl ${perfStats.win_rate > 55 ? 'text-accent-green' : perfStats.win_rate > 45 ? 'text-accent-amber' : 'text-accent-red'}`}>
                {perfStats.win_rate.toFixed(1)}%
              </p>
            </div>
            {(['BUY', 'SELL', 'HOLD'] as const).map((dir) => {
              const stat = perfStats.by_direction[dir];
              const wr = stat.total > 0 ? (stat.correct / stat.total) * 100 : 0;
              return (
                <div key={dir} className="bg-bg-elevated rounded p-3 text-center">
                  <p className="text-[9px] text-text-secondary uppercase mb-1">
                    Signal {dir === 'BUY' ? 'ACHAT' : dir === 'SELL' ? 'VENTE' : 'CONSERVE'}
                  </p>
                  <p className={`font-mono font-bold text-lg ${wr > 55 ? 'text-accent-green' : wr > 45 ? 'text-accent-amber' : 'text-accent-red'}`}>
                    {stat.total > 0 ? `${wr.toFixed(0)}%` : '—'}
                  </p>
                  <p className="text-[9px] text-text-secondary">{stat.correct}/{stat.total}</p>
                </div>
              );
            })}
          </div>
          {perfStats.resolved < 5 && (
            <p className="text-[10px] text-text-secondary mt-2 italic">
              Les prédictions sont résolues après 5 jours de marché. Trop peu de données pour être statistiquement significatif.
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Activity Log + Timeline */}
        <div className="space-y-3">
          <div className="bg-bg-surface rounded-lg border border-border">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="font-syne font-bold text-sm text-text-primary">Timeline du Cycle</h3>
            </div>
            <div className="p-3">
              {cycleTimeline.length === 0 ? (
                <p className="text-[11px] text-text-secondary text-center py-4">En attente du prochain cycle...</p>
              ) : (
                <div className="space-y-1">
                  {[...cycleTimeline].reverse().map((event, i) => (
                    <div key={i} className="flex items-start gap-2 text-[10px]">
                      <span className="text-text-secondary font-mono shrink-0 mt-0.5">
                        {new Date(event.timestamp).toLocaleTimeString('fr-FR')}
                      </span>
                      <div className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${
                        event.status === 'ok' ? 'bg-accent-green' :
                        event.status === 'error' ? 'bg-accent-red' : 'bg-accent-blue animate-pulse'
                      }`} />
                      <span className="text-text-secondary">{event.label}</span>
                      <span className={`ml-auto shrink-0 ${
                        event.status === 'ok' ? 'text-accent-green' :
                        event.status === 'error' ? 'text-accent-red' : 'text-accent-blue'
                      }`}>
                        {event.status === 'running' ? '⟳' : event.status === 'ok' ? '✓' : '✗'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="bg-bg-surface rounded-lg border border-border">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="font-syne font-bold text-sm text-text-primary">Activity Log</h3>
            </div>
            <div className="p-3">
              <ReasoningLog agents={agents} />
            </div>
          </div>
        </div>

        {/* Debate viewer */}
        <div className="xl:col-span-2 space-y-3">
          <div className="bg-bg-surface rounded-lg border border-border">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="font-syne font-bold text-sm text-text-primary">Débat Bull vs Bear</h3>
                <p className="text-[9px] text-text-secondary mt-0.5">
                  Deux agents IA s'affrontent. Le score = conviction bull - conviction bear (-10 à +10).
                </p>
              </div>
              {debates.length > 0 && (
                <div className="flex gap-1.5 flex-wrap">
                  {debates.map((d) => (
                    <button
                      key={d.ticker}
                      onClick={() => setSelectedDebateTicker(d.ticker)}
                      className={`text-xs font-mono px-2 py-0.5 rounded border transition-colors ${
                        (selectedDebateTicker || debates[0]?.ticker) === d.ticker
                          ? 'border-accent-green text-accent-green bg-accent-green/10'
                          : 'border-border text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      {d.ticker}
                      <span className={`ml-1 text-[9px] ${d.debate_score > 0 ? 'text-accent-green' : d.debate_score < 0 ? 'text-accent-red' : 'text-text-secondary'}`}>
                        {d.debate_score > 0 ? '+' : ''}{d.debate_score}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="p-3">
              {selectedDebate ? (
                <DebateViewer debate={selectedDebate} />
              ) : (
                <div className="flex flex-col items-center justify-center h-48 gap-2 text-text-secondary">
                  <span className="text-3xl">⚖️</span>
                  <p className="text-sm">En attente du cycle agents IA</p>
                  <p className="text-[10px]">Le débat s'affichera après la prochaine analyse</p>
                </div>
              )}
            </div>
          </div>

          {/* Signals summary */}
          {signals.length > 0 && (
            <div className="bg-bg-surface rounded-lg border border-border">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <h3 className="font-syne font-bold text-sm text-text-primary">Signaux Actuels</h3>
                <div className="flex gap-2 text-[9px] font-mono">
                  <span className="text-accent-green">{signals.filter(s => s.signal === 'BUY').length} ACHAT</span>
                  <span className="text-accent-red">{signals.filter(s => s.signal === 'SELL').length} VENTE</span>
                  <span className="text-accent-amber">{signals.filter(s => s.signal === 'HOLD').length} CONSERVE</span>
                </div>
              </div>
              <div className="p-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                {signals.map((s) => (
                  <div key={s.ticker} className="flex items-center gap-2 px-3 py-2 bg-bg-elevated rounded border border-border">
                    <span className="font-mono font-bold text-xs text-text-primary">{s.ticker}</span>
                    <div className="flex flex-col ml-auto text-right">
                      <span
                        className="text-[9px] font-mono"
                        style={{ color: s.signal === 'BUY' ? '#00D4AA' : s.signal === 'SELL' ? '#FF4D6D' : '#FFB347' }}
                      >
                        {s.signal}
                      </span>
                      <span className="text-[8px] text-text-secondary">{s.confidence}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
