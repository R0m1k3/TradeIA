import { create } from 'zustand';
import type { SignalItem, MarketContext, ExecutedOrder, AgentStates, AlertItem, DebateOutput, AgentTimelineEvent } from '../types';

interface SignalsStore {
  signals: SignalItem[];
  market: MarketContext;
  ordersExecuted: ExecutedOrder[];
  agents: AgentStates;
  alerts: AlertItem[];
  debates: DebateOutput[];
  lastUpdate: string | null;
  cycleTimeline: AgentTimelineEvent[];
  setSignals: (signals: SignalItem[]) => void;
  setMarket: (market: MarketContext) => void;
  setOrdersExecuted: (orders: ExecutedOrder[]) => void;
  setAgents: (agents: AgentStates, timestamp?: string) => void;
  addAlert: (alert: Omit<AlertItem, 'id' | 'timestamp'>) => void;
  removeAlert: (id: string) => void;
  setDebates: (debates: DebateOutput[]) => void;
  setLastUpdate: (ts: string) => void;
  clearTimeline: () => void;
}

const DEFAULT_AGENTS: AgentStates = {
  collector: { status: 'idle' },
  analyst: { status: 'idle' },
  bull: { status: 'idle' },
  bear: { status: 'idle' },
  strategist: { status: 'idle' },
  risk: { status: 'idle' },
  reporter: { status: 'idle' },
};

const AGENT_LABELS: Record<string, string> = {
  collector: 'Collecte données marché',
  analyst: 'Analyse technique multi-timeframe',
  bull: 'Débat Haussier IA',
  bear: 'Débat Baissier IA',
  strategist: 'Génération ordres',
  risk: 'Validation risque',
  reporter: 'Rapport & broadcast',
};

export const useSignalsStore = create<SignalsStore>((set) => ({
  signals: [],
  market: { vix: 0, fear_greed: 0, nasdaq: 'neutral', nasdaq_change_pct: 0 },
  ordersExecuted: [],
  agents: DEFAULT_AGENTS,
  alerts: [],
  debates: [],
  lastUpdate: null,
  cycleTimeline: [],

  setSignals: (signals) => set({ signals }),
  setMarket: (market) => set((state) => ({ market: { ...state.market, ...market } })),
  setOrdersExecuted: (ordersExecuted) => set({ ordersExecuted }),
  setDebates: (debates) => set({ debates }),
  setLastUpdate: (lastUpdate) => set({ lastUpdate }),
  clearTimeline: () => set({ cycleTimeline: [] }),

  setAgents: (agents, timestamp) =>
    set((state) => {
      const now = timestamp || new Date().toISOString();
      const newEvents: AgentTimelineEvent[] = [];

      for (const [name, newState] of Object.entries(agents) as [string, { status: string }][]) {
        const prev = (state.agents as any)[name];
        if (prev?.status !== newState.status && (newState.status === 'running' || newState.status === 'ok' || newState.status === 'error')) {
          newEvents.push({
            agent: name,
            status: newState.status as AgentTimelineEvent['status'],
            timestamp: now,
            label: AGENT_LABELS[name] || name,
          });
        }
      }

      return {
        agents,
        cycleTimeline: newEvents.length > 0
          ? [...state.cycleTimeline.slice(-29), ...newEvents]
          : state.cycleTimeline,
      };
    }),

  addAlert: (alert) =>
    set((state) => ({
      alerts: [
        ...state.alerts.slice(-9),
        { ...alert, id: Math.random().toString(36).substring(2, 9), timestamp: new Date().toISOString() },
      ],
    })),

  removeAlert: (id) =>
    set((state) => ({ alerts: state.alerts.filter((a) => a.id !== id) })),
}));
