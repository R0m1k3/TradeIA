export type DecisionAction = 'BUY' | 'SELL' | 'HOLD';

export interface DecisionInputsSeen {
  news_count?: number;
  news_positive?: number;
  news_negative?: number;
  has_calibration?: boolean;
  calibration_wr?: number;
  is_held?: boolean;
  segment?: string;
}

export interface DecisionItem {
  ticker: string;
  action: DecisionAction;
  confidence: number;
  reasoning: string;
  size_pct: number;
  limit_price: number;
  stop_loss: number;
  take_profit: number;
  trade_type?: string;
  bull_case: string;
  bear_case: string;
  key_risk: string;
  invalidation: string;
  inputs_seen: DecisionInputsSeen;
  timestamp: string;
}

export interface DecisionsLatestResponse {
  decisions: DecisionItem[];
  cycleAt: string | null;
}
