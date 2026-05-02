export type Signal = 'BUY' | 'SELL' | 'HOLD';
export type RiskRegime = 'NORMAL' | 'ELEVATED' | 'CRISIS';
export type AgentStatus = 'idle' | 'running' | 'ok' | 'error';
export type AlertLevel = 'info' | 'warning' | 'critical';

export interface Position {
  ticker: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  sizeUsd: number;
  pnlUsd: number;
  pnlPct: number;
  stopLoss: number;
  takeProfit: number;
}

export interface Portfolio {
  total_usd: number;
  cash_usd: number;
  daily_pnl_pct: number;
  risk_regime: RiskRegime;
  positions: Position[];
}

export interface MarketContext {
  vix: number;
  fear_greed: number;
  nasdaq: string;
  nasdaq_status?: {
    isOpen: boolean;
    nextOpen: string;
    nextClose: string;
  };
}

export interface SignalItem {
  ticker: string;
  signal: Signal;
  debate_score: number;
  bull_conviction: number;
  bear_conviction: number;
  confidence: number;
  reasoning: string;
}

export interface ExecutedOrder {
  ticker: string;
  action: string;
  filledPrice: number;
  sizeUsd: number;
  orderId: string;
}

export interface AlertItem {
  id: string;
  level: AlertLevel;
  message: string;
  ticker?: string;
  timestamp: string;
}

export interface AgentState {
  status: AgentStatus;
  lastRun?: string;
  durationMs?: number;
  tokensUsed?: number;
  error?: string;
}

export interface AgentStates {
  collector: AgentState;
  analyst: AgentState;
  bull: AgentState;
  bear: AgentState;
  strategist: AgentState;
  risk: AgentState;
  reporter: AgentState;
}

export interface CycleUpdate {
  portfolio: Portfolio;
  market: MarketContext;
  signals: SignalItem[];
  orders_executed: ExecutedOrder[];
  alerts: Omit<AlertItem, 'id' | 'timestamp'>[];
  agents: AgentStates;
}

export interface WsMessage {
  type: string;
  payload: unknown;
  timestamp: string;
}

export interface BullDebate {
  ticker: string;
  upside_pct: number;
  technical_case: string;
  fundamental_catalyst: string;
  sentiment_driver: string;
  bear_rebuttal_1: string;
  bear_rebuttal_2: string;
  conviction: number;
  invalidation_condition: string;
  key_risk: string;
}

export interface BearDebate {
  ticker: string;
  downside_pct: number;
  technical_case: string;
  structural_weakness: string;
  macro_headwind: string;
  bull_rebuttal_1: string;
  bull_rebuttal_2: string;
  conviction: number;
  invalidation_condition: string;
  strongest_bull_argument: string;
}

export interface DebateOutput {
  ticker: string;
  bull: BullDebate;
  bear: BearDebate;
  debate_score: number;
  analyst_output: {
    confidence: number;
    bias_4h: string;
    bias_1h: string;
    signal_15m: string;
    rsi_15m: number;
    rsi_1h: number;
  };
}

export interface Trade {
  id: string;
  ticker: string;
  action: string;
  tradeType: string;
  filledPrice: number;
  quantity: number;
  sizeUsd: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  debateScore: number;
  bullConviction: number;
  bearConviction: number;
  reasoning: string;
  closedAt: string | null;
  closePrice: number | null;
  pnlUsd: number | null;
  closeReason: string | null;
  createdAt: string;
}

export interface OHLCVBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
