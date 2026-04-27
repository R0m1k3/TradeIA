import { create } from 'zustand';

interface Config {
  llm_provider: string;
  model_light: string;
  model_mid: string;
  model_strong: string;
  watchlist: string;
  portfolio_usd: string;
  daily_loss_limit_pct: string;
  mock_broker: string;
  [key: string]: string;
}

interface ConfigStore {
  config: Config;
  paused: boolean;
  setConfig: (config: Partial<Config>) => void;
  setPaused: (paused: boolean) => void;
  fetchConfig: () => Promise<void>;
  saveConfig: (updates: Partial<Config>) => Promise<void>;
}

const API = import.meta.env.VITE_API_URL || '/api';

export const useConfigStore = create<ConfigStore>((set, get) => ({
  config: {
    llm_provider: 'openrouter',
    model_light: 'anthropic/claude-haiku-4-5',
    model_mid: 'anthropic/claude-sonnet-4-5',
    model_strong: 'anthropic/claude-opus-4',
    watchlist: 'AAPL,MSFT,GOOGL,NVDA,TSLA',
    portfolio_usd: '10000',
    daily_loss_limit_pct: '3',
    mock_broker: 'true',
  },
  paused: false,

  setConfig: (updates) => set((state) => ({ config: { ...state.config, ...updates } })),
  setPaused: (paused) => set({ paused }),

  fetchConfig: async () => {
    try {
      const res = await fetch(`${API}/config`);
      if (res.ok) {
        const data = await res.json() as Config;
        set({ config: { ...get().config, ...data } });
      }
    } catch {
      // ignore
    }
  },

  saveConfig: async (updates) => {
    try {
      await fetch(`${API}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      set((state) => ({ config: { ...state.config, ...updates } }));
    } catch {
      // ignore
    }
  },
}));
