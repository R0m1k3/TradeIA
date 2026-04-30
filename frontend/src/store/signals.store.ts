import { create } from 'zustand';
import type { SignalItem, MarketContext, ExecutedOrder, AgentStates, AlertItem, DebateOutput } from '../types';

interface SignalsStore {
  signals: SignalItem[];
  market: MarketContext;
  ordersExecuted: ExecutedOrder[];
  agents: AgentStates;
  alerts: AlertItem[];
  debates: DebateOutput[];
  lastUpdate: string | null;
  setSignals: (signals: SignalItem[]) => void;
  setMarket: (market: MarketContext) => void;
  setOrdersExecuted: (orders: ExecutedOrder[]) => void;
  setAgents: (agents: AgentStates) => void;
  addAlert: (alert: Omit<AlertItem, 'id' | 'timestamp'>) => void;
  removeAlert: (id: string) => void;
  setDebates: (debates: DebateOutput[]) => void;
  setLastUpdate: (ts: string) => void;
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

export const useSignalsStore = create<SignalsStore>((set) => ({
  signals: [],
  market: { vix: 0, fear_greed: 0, nasdaq: 'neutral' },
  ordersExecuted: [],
  agents: DEFAULT_AGENTS,
  alerts: [],
  debates: [],
  lastUpdate: null,

  setSignals: (signals) => set({ signals }),
  setMarket: (market) => set({ market }),
  setOrdersExecuted: (ordersExecuted) => set({ ordersExecuted }),
  setAgents: (agents) => set({ agents }),
  setDebates: (debates) => set({ debates }),
  setLastUpdate: (lastUpdate) => set({ lastUpdate }),

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
