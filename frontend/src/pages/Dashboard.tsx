import { useState } from 'react';
import { usePortfolioStore } from '../store/portfolio.store';
import { useSignalsStore } from '../store/signals.store';
import { KpiCard } from '../components/cards/KpiCard';
import { SignalFeed } from '../components/cards/SignalFeed';
import { CandlestickChart } from '../components/charts/CandlestickChart';
import type { Page } from '../App';
import type { OHLCVBar } from '../types';
import { getTickerName } from '../data/tickerNames';

const SIGNAL_COLOR: Record<string, string> = {
  BUY: '#00D4AA',
  SELL: '#FF4D6D',
  HOLD: '#FFB347',
};
const SIGNAL_LABEL: Record<string, string> = {
  BUY: 'ACHAT',
  SELL: 'VENTE',
  HOLD: 'CONSERVE',
};
const AGENT_ICONS: Record<string, string> = {
  collector: '📊',
  analyst: '🧮',
  bull: '🟢',
  bear: '🔴',
  strategist: '📋',
  risk: '🛡️',
  reporter: '📡',
};

interface DashboardProps {
  onNavigate: (page: Page) => void;
}

function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <div className="relative group inline-block">
      {children}
      <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 bg-bg-elevated border border-border rounded px-2 py-1.5 text-[10px] text-text-secondary leading-tight opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        {text}
      </div>
    </div>
  );
}

function FearGreedGauge({ value }: { value: number }) {
  const color =
    value > 70 ? '#FF4D6D' :
    value > 55 ? '#FFB347' :
    value > 45 ? '#8892A4' :
    value > 30 ? '#4A9EFF' : '#00D4AA';
  const label =
    value > 70 ? 'Ext. Cupidité' :
    value > 55 ? 'Cupidité' :
    value > 45 ? 'Neutre' :
    value > 30 ? 'Peur' : 'Ext. Peur';
  const pct = (value / 100) * 100;

  return (
    <Tooltip text="Indice CNN mesurant l'émotion dominante des investisseurs (0=Peur extrême, 100=Cupidité extrême). En dessous de 30 = opportunité d'achat historique.">
      <div className="flex flex-col items-center gap-1">
        <div className="relative w-14 h-14">
          <svg className="w-14 h-14 -rotate-90" viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="#1E2D45" strokeWidth="3" />
            <circle
              cx="18" cy="18" r="15.9" fill="none"
              stroke={color} strokeWidth="3"
              strokeDasharray={`${pct} ${100 - pct}`}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="font-syne font-bold text-sm" style={{ color }}>{value}</span>
          </div>
        </div>
        <span className="text-[9px] text-text-secondary font-mono text-center">{label}</span>
      </div>
    </Tooltip>
  );
}

function MacroPanel({ macro, sectorBiases }: {
  macro?: { fed_funds_rate: number | null; yield_curve: number | null; macro_regime: string } | null;
  sectorBiases?: Record<string, { direction: string; change_pct: number; etf: string }> | null;
}) {
  if (!macro && !sectorBiases) return null;

  return (
    <div className="bg-bg-surface rounded-lg border border-border p-4">
      <h3 className="font-syne font-bold text-sm text-text-primary mb-3">Contexte Macro & Secteurs</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        {macro?.fed_funds_rate != null && (
          <Tooltip text="Taux directeur de la Réserve Fédérale américaine. Plus il est élevé, plus les conditions de crédit sont restrictives pour les entreprises.">
            <div className="bg-bg-elevated rounded p-2">
              <p className="text-[9px] text-text-secondary uppercase tracking-wider">Taux Fed</p>
              <p className={`font-mono font-bold text-sm ${macro.fed_funds_rate > 4 ? 'text-accent-red' : 'text-accent-green'}`}>
                {macro.fed_funds_rate.toFixed(2)}%
              </p>
            </div>
          </Tooltip>
        )}
        {macro?.yield_curve != null && (
          <Tooltip text="Spread entre obligations 10 ans et 2 ans. Négatif (courbe inversée) = signal de récession possible. Positif = économie en croissance.">
            <div className="bg-bg-elevated rounded p-2">
              <p className="text-[9px] text-text-secondary uppercase tracking-wider">Courbe 10Y-2Y</p>
              <p className={`font-mono font-bold text-sm ${macro.yield_curve < 0 ? 'text-accent-red' : 'text-accent-green'}`}>
                {macro.yield_curve > 0 ? '+' : ''}{macro.yield_curve.toFixed(2)}%
              </p>
            </div>
          </Tooltip>
        )}
        {macro?.macro_regime && (
          <Tooltip text="Régime macro synthétique basé sur taux Fed + courbe de taux. EXPANSIF = conditions favorables aux actions. RESTRICTIF = prudence.">
            <div className="bg-bg-elevated rounded p-2">
              <p className="text-[9px] text-text-secondary uppercase tracking-wider">Régime Macro</p>
              <p className={`font-mono font-bold text-xs ${
                macro.macro_regime === 'EXPANSIF' ? 'text-accent-green' :
                macro.macro_regime === 'RESTRICTIF' ? 'text-accent-red' : 'text-accent-amber'
              }`}>{macro.macro_regime}</p>
            </div>
          </Tooltip>
        )}
      </div>

      {sectorBiases && Object.keys(sectorBiases).length > 0 && (
        <div>
          <p className="text-[9px] text-text-secondary uppercase tracking-wider mb-1.5">Biais Sectoriels</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(sectorBiases).map(([sector, bias]) => (
              <Tooltip key={sector} text={`ETF ${bias.etf} : ${bias.change_pct > 0 ? '+' : ''}${bias.change_pct.toFixed(2)}% aujourd'hui. Les agents IA favorisent les tickers dans les secteurs haussiers.`}>
                <span
                  className="text-[9px] font-mono px-2 py-0.5 rounded border"
                  style={{
                    color: bias.direction === 'bullish' ? '#00D4AA' : bias.direction === 'bearish' ? '#FF4D6D' : '#8892A4',
                    borderColor: bias.direction === 'bullish' ? '#00D4AA40' : bias.direction === 'bearish' ? '#FF4D6D40' : '#8892A440',
                    background: bias.direction === 'bullish' ? '#00D4AA08' : bias.direction === 'bearish' ? '#FF4D6D08' : 'transparent',
                  }}
                >
                  {bias.direction === 'bullish' ? '↑' : bias.direction === 'bearish' ? '↓' : '→'} {sector}
                  <span className="ml-1 opacity-60">{bias.change_pct > 0 ? '+' : ''}{bias.change_pct.toFixed(1)}%</span>
                </span>
              </Tooltip>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AgentTimeline({ timeline, agents }: {
  timeline: Array<{ agent: string; status: string; timestamp: string; label: string }>;
  agents: Record<string, { status: string; lastRun?: string }>;
}) {
  const agentOrder = ['collector', 'analyst', 'bull', 'bear', 'strategist', 'risk', 'reporter'];
  const isCycleActive = Object.values(agents).some((a) => a.status === 'running');

  return (
    <div className="bg-bg-surface rounded-lg border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-syne font-bold text-sm text-text-primary">Pipeline Agents IA</h3>
        {isCycleActive && (
          <span className="flex items-center gap-1.5 text-[10px] text-accent-blue font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-blue animate-pulse" />
            Cycle en cours
          </span>
        )}
      </div>

      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {agentOrder.map((name, idx) => {
          const state = (agents as any)[name] as { status: string };
          const icon = AGENT_ICONS[name] || '🤖';
          const isRunning = state?.status === 'running';
          const isDone = state?.status === 'ok';
          const isError = state?.status === 'error';
          const isIdle = !isRunning && !isDone && !isError;

          return (
            <div key={name} className="flex items-center gap-1 shrink-0">
              <Tooltip text={`Agent ${name} — ${
                isRunning ? 'En cours d\'exécution' :
                isDone ? 'Terminé avec succès' :
                isError ? 'Erreur détectée' : 'En attente'
              }`}>
                <div className={`flex flex-col items-center gap-1 px-2 py-1.5 rounded border transition-all ${
                  isRunning ? 'border-accent-blue bg-accent-blue/10' :
                  isDone ? 'border-accent-green/40 bg-accent-green/5' :
                  isError ? 'border-accent-red/40 bg-accent-red/5' :
                  'border-border bg-transparent opacity-40'
                }`}>
                  <span className={`text-lg ${isRunning ? 'animate-pulse' : ''}`}>{icon}</span>
                  <span className="text-[8px] font-mono text-text-secondary capitalize">{name}</span>
                  <div className={`w-1.5 h-1.5 rounded-full ${
                    isRunning ? 'bg-accent-blue animate-pulse' :
                    isDone ? 'bg-accent-green' :
                    isError ? 'bg-accent-red' :
                    'bg-border'
                  }`} />
                </div>
              </Tooltip>
              {idx < agentOrder.length - 1 && (
                <div className={`w-4 h-px ${isDone ? 'bg-accent-green/40' : 'bg-border'}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* Derniers événements timeline */}
      {timeline.length > 0 && (
        <div className="mt-3 space-y-0.5 max-h-24 overflow-y-auto">
          {[...timeline].reverse().slice(0, 6).map((event, i) => (
            <div key={i} className="flex items-center gap-2 text-[10px]">
              <span className="text-text-secondary font-mono shrink-0">
                {new Date(event.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span className={`shrink-0 ${
                event.status === 'ok' ? 'text-accent-green' :
                event.status === 'error' ? 'text-accent-red' : 'text-accent-blue'
              }`}>
                {AGENT_ICONS[event.agent] || '🤖'}
              </span>
              <span className="text-text-secondary truncate">{event.label}</span>
              <span className={`ml-auto shrink-0 font-mono ${
                event.status === 'ok' ? 'text-accent-green' :
                event.status === 'error' ? 'text-accent-red' : 'text-accent-blue'
              }`}>
                {event.status === 'running' ? '...' : event.status === 'ok' ? '✓' : '✗'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NasdaqStatusCard({ market }: { market: ReturnType<typeof useSignalsStore>['market'] }) {
  const status = market.nasdaq_status;
  const isOpen = status?.isOpen ?? false;
  const trendColor = market.nasdaq === 'bullish' ? 'text-accent-green' : market.nasdaq === 'bearish' ? 'text-accent-red' : 'text-text-secondary';
  const trendArrow = market.nasdaq === 'bullish' ? '↑' : market.nasdaq === 'bearish' ? '↓' : '→';
  const trendLabel = market.nasdaq === 'bullish' ? 'Haussier' : market.nasdaq === 'bearish' ? 'Baissier' : 'Neutre';
  const change = market.nasdaq_change_pct ?? 0;
  const changePositive = change >= 0;

  return (
    <div className="bg-bg-surface rounded-lg border border-border p-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className={`w-2.5 h-2.5 rounded-full ${isOpen ? 'bg-accent-green animate-pulse' : 'bg-accent-red'}`} />
        <div>
          <p className="text-[10px] text-text-secondary uppercase tracking-wider">NASDAQ</p>
          <p className={`font-syne font-bold text-sm ${trendColor}`}>
            {trendArrow} {trendLabel}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-center">
          <p className="text-[10px] text-text-secondary uppercase tracking-wider">Variation</p>
          <p className={`font-mono font-bold text-sm ${changePositive ? 'text-accent-green' : 'text-accent-red'}`}>
            {changePositive ? '+' : ''}{change.toFixed(2)}%
          </p>
        </div>
        <div className="text-right">
          <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${isOpen ? 'bg-accent-green/10 text-accent-green border border-accent-green/30' : 'bg-accent-red/10 text-accent-red border border-accent-red/30'}`}>
            {isOpen ? 'OUVERT' : 'FERMÉ'}
          </span>
          {status && !isOpen && status.nextOpen && (
            <p className="text-[10px] text-text-secondary font-mono mt-1">{status.nextOpen}</p>
          )}
          {status && isOpen && status.nextClose && (
            <p className="text-[10px] text-text-secondary font-mono mt-1">{status.nextClose}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function Dashboard({ onNavigate: _ }: DashboardProps) {
  const { portfolio } = usePortfolioStore();
  const { signals, market, agents, cycleTimeline } = useSignalsStore();
  const [selectedTicker, setSelectedTicker] = useState('AAPL');
  const [analyzing, setAnalyzing] = useState(false);

  async function triggerAnalysis() {
    setAnalyzing(true);
    try {
      const api = import.meta.env.VITE_API_URL || '/api';
      await fetch(`${api}/orchestrator/run`, { method: 'POST' });
    } catch (err) {
      console.error('Failed to trigger analysis:', err);
    }
    setTimeout(() => setAnalyzing(false), 2000);
  }

  const selectedSignal = signals.find((s) => s.ticker === selectedTicker);

  const mockBars: OHLCVBar[] = Array.from({ length: 100 }, (_, i) => {
    const base = 180;
    const t = new Date(Date.now() - (99 - i) * 15 * 60 * 1000);
    const open = base + Math.sin(i * 0.3) * 5 + Math.random() * 2;
    const close = open + (Math.random() - 0.48) * 3;
    return {
      time: t.toISOString(),
      open,
      high: Math.max(open, close) + Math.random(),
      low: Math.min(open, close) - Math.random(),
      close,
      volume: 500000 + Math.random() * 300000,
    };
  });

  const pnlPositive = portfolio.daily_pnl_pct >= 0;
  const macro = (market as any).macro as { fed_funds_rate: number | null; yield_curve: number | null; macro_regime: string } | null;
  const sectorBiases = (market as any).sector_biases as Record<string, { direction: string; change_pct: number; etf: string }> | null;

  return (
    <div className="space-y-4 max-w-[1600px]">
      <div className="flex items-center justify-between">
        <h2 className="font-syne font-bold text-xl text-text-primary tracking-tight">Vue Marché</h2>
        <button
          onClick={triggerAnalysis}
          disabled={analyzing}
          className={`
            px-4 py-2 rounded text-xs font-mono font-bold transition-all duration-200 flex items-center gap-2
            ${analyzing
              ? 'bg-accent-blue/20 text-accent-blue border border-accent-blue/30'
              : 'bg-accent-green/10 border border-accent-green/40 text-accent-green hover:bg-accent-green/20'
            }
          `}
        >
          {analyzing ? (
            <>
              <span className="w-2 h-2 rounded-full bg-accent-blue animate-pulse" />
              Analyse IA en cours...
            </>
          ) : (
            <>
              <span className="text-lg">⚡</span>
              Forcer l'analyse IA
            </>
          )}
        </button>
      </div>

      {/* NASDAQ Status */}
      <NasdaqStatusCard market={market} />

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tooltip text="Valeur totale du portefeuille = liquidités + valeur actuelle des positions ouvertes + gains/pertes non-réalisés.">
          <KpiCard
            label="Valeur Portfolio"
            value={`$${portfolio.total_usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            sub={`Liquidités $${portfolio.cash_usd.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
            accentColor="#00D4AA"
          />
        </Tooltip>
        <Tooltip text="Performance du jour incluant gains réalisés (trades fermés) ET gains/pertes latents sur positions ouvertes.">
          <KpiCard
            label="P&L Jour"
            value={`${pnlPositive ? '+' : ''}${portfolio.daily_pnl_pct.toFixed(2)}%`}
            sub={`${pnlPositive ? '+' : ''}$${((portfolio.total_usd * portfolio.daily_pnl_pct) / 100).toFixed(2)}`}
            subPositive={pnlPositive}
            accentColor={pnlPositive ? '#00D4AA' : '#FF4D6D'}
          />
        </Tooltip>
        <Tooltip text="Nombre de trades actifs en ce moment. Chaque position a un stop-loss (limite de perte) et un objectif de profit définis automatiquement.">
          <KpiCard
            label="Positions Ouvertes"
            value={String(portfolio.positions.length)}
            sub={`${signals.filter((s) => s.signal === 'BUY').length} signaux ACHAT`}
            accentColor="#4A9EFF"
          />
        </Tooltip>
        <Tooltip text="Régime de risque basé sur la performance journalière. NORMAL : trading libre. ELEVATED : pertes >2%. CRISIS : pertes >3%, aucun achat autorisé.">
          <KpiCard
            label="Risque"
            value={portfolio.risk_regime}
            sub={`VIX ${market.vix.toFixed(1)}`}
            accentColor={portfolio.risk_regime === 'NORMAL' ? '#00D4AA' : portfolio.risk_regime === 'ELEVATED' ? '#FFB347' : '#FF4D6D'}
          />
        </Tooltip>
      </div>

      {/* Agent Pipeline Timeline */}
      <AgentTimeline timeline={cycleTimeline} agents={agents as any} />

      {/* Macro + Sectors */}
      <MacroPanel macro={macro} sectorBiases={sectorBiases} />

      {/* Main content */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        {/* Left: Chart (3/5) */}
        <div className="xl:col-span-3 space-y-3">
          <div className="bg-bg-surface rounded-lg border border-border overflow-hidden">
            {/* Ticker pills */}
            <div className="px-4 py-3 border-b border-border flex items-center gap-2 flex-wrap">
              {signals.map((s) => {
                const t = s.ticker;
                const sigColor = SIGNAL_COLOR[s.signal] || '#8892A4';
                return (
                  <button
                    key={t}
                    onClick={() => setSelectedTicker(t)}
                    className={`
                      px-2.5 py-1 rounded text-xs font-mono font-bold transition-all duration-150
                      ${selectedTicker === t
                        ? 'bg-accent-green/10 border border-accent-green text-accent-green'
                        : 'border border-border text-text-secondary hover:text-text-primary hover:border-border/60'
                      }
                    `}
                  >
                    {t}
                    <span className="ml-1 text-[9px] text-text-secondary font-normal">{getTickerName(t)}</span>
                    <span className="ml-1.5 text-[9px]" style={{ color: sigColor }}>●</span>
                  </button>
                );
              })}
            </div>

            <CandlestickChart data={mockBars} ticker={selectedTicker} height={320} />

            {/* Signal détail avec explication */}
            {selectedSignal && (
              <div className="border-t border-border">
                <div className="grid grid-cols-3 divide-x divide-border">
                  <Tooltip text="Score de conviction calculé par l'IA : base 30 + alignement tendances + signal entrée + volume. Au dessus de 65 = signal retenu.">
                    <div className="px-4 py-2">
                      <p className="text-[10px] text-text-secondary uppercase tracking-wider">Confiance IA</p>
                      <p className={`text-sm font-mono font-bold ${selectedSignal.confidence > 70 ? 'text-accent-amber' : 'text-text-primary'}`}>
                        {selectedSignal.confidence || '—'}%
                      </p>
                    </div>
                  </Tooltip>
                  <Tooltip text="Recommandation finale : ACHAT (tendance haussière forte), VENTE (signal baissier), ou CONSERVE (signal insuffisant).">
                    <div className="px-4 py-2">
                      <p className="text-[10px] text-text-secondary uppercase tracking-wider">Signal</p>
                      <p className="text-sm font-mono font-bold" style={{ color: SIGNAL_COLOR[selectedSignal.signal] }}>
                        {SIGNAL_LABEL[selectedSignal.signal] || selectedSignal.signal}
                      </p>
                    </div>
                  </Tooltip>
                  <Tooltip text="Score du débat Bull vs Bear : positif = les optimistes l'emportent, négatif = les pessimistes dominent. Plage : -10 à +10.">
                    <div className="px-4 py-2">
                      <p className="text-[10px] text-text-secondary uppercase tracking-wider">Débat</p>
                      <div className="flex items-center gap-2">
                        <p className={`text-sm font-mono font-bold ${selectedSignal.debate_score > 0 ? 'text-accent-green' : selectedSignal.debate_score < 0 ? 'text-accent-red' : 'text-text-secondary'}`}>
                          {selectedSignal.debate_score > 0 ? '+' : ''}{selectedSignal.debate_score}
                        </p>
                        <div className="flex gap-0.5">
                          <span className="text-[9px] text-accent-green font-mono">🟢{selectedSignal.bull_conviction}</span>
                          <span className="text-[9px] text-text-secondary">vs</span>
                          <span className="text-[9px] text-accent-red font-mono">🔴{selectedSignal.bear_conviction}</span>
                        </div>
                      </div>
                    </div>
                  </Tooltip>
                </div>
                {selectedSignal.reasoning && (
                  <div className="px-4 py-2 border-t border-border/50 bg-bg-elevated/50">
                    <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-0.5">Raisonnement IA</p>
                    <p className="text-[11px] text-text-primary leading-relaxed">{selectedSignal.reasoning}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right: Signal feed + context (2/5) */}
        <div className="xl:col-span-2 space-y-3">
          {/* Agent Signal Feed */}
          <div className="bg-bg-surface rounded-lg border border-border">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="font-syne font-bold text-sm text-text-primary">Flux Agents</h3>
            </div>
            <div className="p-3">
              <SignalFeed signals={signals} />
            </div>
          </div>

          {/* Market Context */}
          <div className="bg-bg-surface rounded-lg border border-border">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="font-syne font-bold text-sm text-text-primary">Contexte Marché</h3>
            </div>
            <div className="p-4 flex items-center justify-around">
              <Tooltip text="VIX = indice de volatilité du marché. >30 = panique, nouveaux achats bloqués. 15-25 = normal. <15 = calme, potentiellement complaisant.">
                <div className="text-center">
                  <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-1">VIX</p>
                  <p className={`font-syne font-bold text-xl ${market.vix > 25 ? 'text-accent-red' : market.vix > 18 ? 'text-accent-amber' : 'text-accent-green'}`}>
                    {market.vix.toFixed(1)}
                  </p>
                  <p className="text-[9px] text-text-secondary">
                    {market.vix > 30 ? '⚠️ Achat bloqué' : market.vix > 20 ? 'Volatile' : 'Normal'}
                  </p>
                </div>
              </Tooltip>
              <div>
                <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-2 text-center">Peur & Cupidité</p>
                <FearGreedGauge value={market.fear_greed} />
              </div>
              <Tooltip text="Direction du NASDAQ (QQQ ETF). Utilisée par l'agent analyste pour confirmer ou infirmer les biais de tendance.">
                <div className="text-center">
                  <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-1">NASDAQ</p>
                  <p className={`font-syne font-bold text-sm ${market.nasdaq === 'bullish' ? 'text-accent-green' : market.nasdaq === 'bearish' ? 'text-accent-red' : 'text-text-secondary'}`}>
                    {market.nasdaq === 'bullish' ? '↑' : market.nasdaq === 'bearish' ? '↓' : '→'}{' '}
                    {market.nasdaq === 'bullish' ? 'Haussier' : market.nasdaq === 'bearish' ? 'Baissier' : 'Neutre'}
                  </p>
                  <p className={`text-[10px] font-mono ${(market.nasdaq_change_pct ?? 0) >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                    {(market.nasdaq_change_pct ?? 0) >= 0 ? '+' : ''}{(market.nasdaq_change_pct ?? 0).toFixed(2)}%
                  </p>
                </div>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>

      {/* Watchlist table */}
      <div className="bg-bg-surface rounded-lg border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="font-syne font-bold text-sm text-text-primary">Liste de Surveillance</h3>
          <p className="text-[10px] text-text-secondary">Résultats du dernier cycle IA — mise à jour automatique toutes les 5 minutes</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                {[
                  { label: 'Ticker', tip: 'Symbole boursier' },
                  { label: 'Entreprise', tip: 'Nom de l\'entreprise' },
                  { label: 'Signal', tip: 'Recommandation de l\'IA : ACHAT, VENTE, ou CONSERVE' },
                  { label: 'Score Débat', tip: 'Bull - Bear conviction (-10 à +10). Positif = les optimistes gagnent.' },
                  { label: 'Conv. Haussier', tip: 'Score de conviction de l\'agent bullish (0-10)' },
                  { label: 'Conv. Baissier', tip: 'Score de conviction de l\'agent bearish (0-10)' },
                  { label: 'Confiance', tip: 'Score composite basé sur indicateurs techniques + alignement tendances' },
                  { label: 'Raisonnement', tip: 'Extrait du raisonnement de l\'agent haussier' },
                ].map((h) => (
                  <th key={h.label} className="text-left px-4 py-2 text-[10px] text-text-secondary uppercase tracking-wider font-normal">
                    <Tooltip text={h.tip}><span className="cursor-help border-b border-dashed border-text-secondary/30">{h.label}</span></Tooltip>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {signals.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-text-secondary">
                    En attente du cycle IA... Cliquez sur "Forcer l'analyse IA" pour lancer immédiatement.
                  </td>
                </tr>
              ) : (
                signals.map((s, i) => {
                  const sigColor = SIGNAL_COLOR[s.signal] || '#8892A4';
                  return (
                    <tr
                      key={s.ticker}
                      className="border-b border-border/50 hover:bg-bg-elevated transition-colors cursor-pointer"
                      style={{ background: i % 2 === 0 ? undefined : '#111827' }}
                      onClick={() => setSelectedTicker(s.ticker)}
                    >
                      <td className="px-4 py-3 font-mono font-bold text-text-primary">{s.ticker}</td>
                      <td className="px-4 py-3 text-text-secondary text-[11px]">{getTickerName(s.ticker)}</td>
                      <td className="px-4 py-3">
                        <span
                          className="px-2 py-0.5 rounded text-[10px] font-mono font-bold"
                          style={{ background: `${sigColor}15`, border: `1px solid ${sigColor}50`, color: sigColor }}
                        >
                          {SIGNAL_LABEL[s.signal] || s.signal}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="font-mono font-bold"
                            style={{ color: s.debate_score > 0 ? '#00D4AA' : s.debate_score < 0 ? '#FF4D6D' : '#FFB347' }}
                          >
                            {s.debate_score > 0 ? '+' : ''}{s.debate_score}
                          </span>
                          <div className="flex gap-0.5">
                            {Array.from({ length: 5 }).map((_, j) => (
                              <div
                                key={j}
                                className="w-1 h-2.5 rounded-sm"
                                style={{ background: j < Math.abs(s.debate_score) ? (s.debate_score > 0 ? '#00D4AA' : '#FF4D6D') : '#1E2D45' }}
                              />
                            ))}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-accent-green">{s.bull_conviction}/10</td>
                      <td className="px-4 py-3 font-mono text-accent-red">{s.bear_conviction}/10</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-accent-blue">{s.confidence}%</span>
                          <div className="w-12 h-1 bg-border rounded-full">
                            <div
                              className="h-1 rounded-full bg-accent-blue"
                              style={{ width: `${s.confidence}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-text-secondary max-w-[180px] truncate">{s.reasoning}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
