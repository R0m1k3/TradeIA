import { create } from 'zustand';

interface Config {
  llm_provider: string;
  model_light: string;
  model_mid: string;
  model_strong: string;
  watchlist: string;
  portfolio_usd: string;
  daily_loss_limit_pct: string;
  max_drawdown_pct: string;
  mock_broker: string;
  ollama_base_url: string;
  [key: string]: string;
}

interface ConfigSecrets {
  openrouter_api_key: boolean;
  alpha_vantage_key: boolean;
  polygon_key: boolean;
  finnhub_key: boolean;
  fred_api_key: boolean;
}

interface ConfigStore {
  config: Config;
  secretsConfigured: ConfigSecrets;
  paused: boolean;
  setConfig: (config: Partial<Config>) => void;
  setPaused: (paused: boolean) => void;
  fetchConfig: () => Promise<void>;
  saveConfig: (updates: Partial<Config>) => Promise<void>;
  saveSecret: (key: string, value: string) => Promise<void>;
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
    max_drawdown_pct: '10',
    mock_broker: 'true',
    ollama_base_url: '',
  },
  secretsConfigured: {
    openrouter_api_key: false,
    alpha_vantage_key: false,
    polygon_key: false,
    finnhub_key: false,
    fred_api_key: false,
  },
  paused: false,

  setConfig: (updates) => set((state) => ({ config: { ...state.config, ...updates } })),
  setPaused: (paused) => set({ paused }),

  fetchConfig: async () => {
    try {
      const res = await fetch(`${API}/config`);
      if (res.ok) {
        const data = await res.json();
        const { secrets_configured, ...configData } = data;
        set({
          config: { ...get().config, ...configData },
          secretsConfigured: secrets_configured || get().secretsConfigured,
        });
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

  saveSecret: async (key: string, value: string) => {
    try {
      const res = await fetch(`${API}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Optimistically update the flag, then re-fetch to confirm DB state
      set((state) => ({
        secretsConfigured: { ...state.secretsConfigured, [key]: value.length > 0 },
      }));
      // Re-fetch full config to sync secretsConfigured from the source of truth (DB)
      await get().fetchConfig();
    } catch (err) {
      console.error(`[Config] Failed to save secret ${key}:`, err);
    }
  },
}));
