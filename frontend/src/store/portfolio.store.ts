import { create } from 'zustand';
import type { Portfolio, Trade } from '../types';

const DEFAULT_PORTFOLIO: Portfolio = {
  total_usd: 10000,
  cash_usd: 10000,
  daily_pnl_pct: 0,
  risk_regime: 'NORMAL',
  positions: [],
};

interface PortfolioStore {
  portfolio: Portfolio;
  trades: Trade[];
  history: Trade[];
  setPortfolio: (p: Portfolio) => void;
  setTrades: (t: Trade[]) => void;
  setHistory: (h: Trade[]) => void;
  fetchPortfolio: () => Promise<void>;
  fetchHistory: () => Promise<void>;
}

const API = import.meta.env.VITE_API_URL || '/api';

export const usePortfolioStore = create<PortfolioStore>((set) => ({
  portfolio: DEFAULT_PORTFOLIO,
  trades: [],
  history: [],

  setPortfolio: (portfolio) => set({ portfolio }),
  setTrades: (trades) => set({ trades }),
  setHistory: (history) => set({ history }),

  fetchPortfolio: async () => {
    try {
      const res = await fetch(`${API}/portfolio`);
      if (res.ok) {
        const data = await res.json() as Portfolio;
        set({ portfolio: data });
      }
    } catch {
      // ignore
    }
  },

  fetchHistory: async () => {
    try {
      const res = await fetch(`${API}/portfolio/history`);
      if (res.ok) {
        const data = await res.json() as Trade[];
        set({ history: data });
      }
    } catch {
      // ignore
    }
  },
}));
