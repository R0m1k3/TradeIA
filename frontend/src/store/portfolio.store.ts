import { create } from 'zustand';
import type { Portfolio, Trade } from '../types';

export interface TradeTypeStats {
  by_type: Record<string, {
    trades: number;
    wins: number;
    total_pnl: number;
    avg_pnl: number;
    avg_hold_hours: number;
    win_rate: number;
  }>;
  overall: {
    total_trades: number;
    win_rate: number;
    total_pnl: number;
    max_drawdown_pct: number;
  };
}

const DEFAULT_PORTFOLIO: Portfolio = {
  total_usd: 10000,
  cash_usd: 10000,
  daily_pnl_pct: 0,
  risk_regime: 'NORMAL',
  initial_capital: 10000,
  equity_peak: 10000,
  drawdown_from_peak_pct: 0,
  positions: [],
};

interface PortfolioStore {
  portfolio: Portfolio;
  trades: Trade[];
  history: Trade[];
  typeStats: TradeTypeStats | null;
  setPortfolio: (p: Portfolio) => void;
  setTrades: (t: Trade[]) => void;
  setHistory: (h: Trade[]) => void;
  fetchPortfolio: () => Promise<void>;
  fetchHistory: () => Promise<void>;
  fetchTypeStats: () => Promise<void>;
}

const API = import.meta.env.VITE_API_URL || '/api';

export const usePortfolioStore = create<PortfolioStore>((set) => ({
  portfolio: DEFAULT_PORTFOLIO,
  trades: [],
  history: [],
  typeStats: null,

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

  fetchTypeStats: async () => {
    try {
      const res = await fetch(`${API}/portfolio/stats-by-type`);
      if (res.ok) {
        const data = await res.json() as TradeTypeStats;
        set({ typeStats: data });
      }
    } catch {
      // ignore
    }
  },
}));
