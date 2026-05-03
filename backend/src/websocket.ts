import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';

let wss: WebSocketServer;
const clients = new Set<WebSocket>();

export function initWebSocket(server: HttpServer) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`[WS] Client connected. Total: ${clients.size}`);

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`[WS] Client disconnected. Total: ${clients.size}`);
    });

    ws.on('error', (err) => {
      console.error('[WS] Client error:', err.message);
      clients.delete(ws);
    });

    ws.send(JSON.stringify({ type: 'CONNECTED', payload: { timestamp: new Date().toISOString() } }));
  });

  wss.on('error', (err) => {
    console.error('[WS] Server error:', err);
  });
}

export function broadcast(type: string, payload: unknown) {
  const message = JSON.stringify({ type, payload, timestamp: new Date().toISOString() });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
      } catch {
        clients.delete(client);
      }
    }
  }
}

export function broadcastCycleUpdate(payload: CycleUpdatePayload) {
  broadcast('CYCLE_UPDATE', payload);
}

export function broadcastAlert(level: 'info' | 'warning' | 'critical', message: string, ticker?: string) {
  broadcast('ALERT', { level, message, ticker });
}

export function broadcastPositionClosed(ticker: string, pnlUsd: number, reason: string) {
  broadcast('POSITION_CLOSED', { ticker, pnlUsd, reason });
}

export function broadcastOverrideAck(action: string, ticker: string) {
  broadcast('OVERRIDE_ACK', { action, ticker });
}

export interface CycleUpdatePayload {
  portfolio?: {
    total_usd: number;
    cash_usd: number;
    daily_pnl_pct: number;
    risk_regime: string;
    initial_capital: number;
    equity_peak: number;
    drawdown_from_peak_pct: number;
    positions: PortfolioPosition[];
  };
  market?: {
    vix: number;
    fear_greed: number;
    nasdaq: string;
    nasdaq_change_pct: number;
    nasdaq_status?: {
      isOpen: boolean;
      nextOpen: string;
      nextClose: string;
    };
  };
  signals?: SignalItem[];
  orders_executed?: ExecutedOrder[];
  alerts?: AlertItem[];
  agents?: AgentStatus;
}

export interface PortfolioPosition {
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

export interface SignalItem {
  ticker: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
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
  level: 'info' | 'warning' | 'critical';
  message: string;
  ticker?: string;
}

export interface AgentStatus {
  collector: AgentState;
  analyst: AgentState;
  bull: AgentState;
  bear: AgentState;
  strategist: AgentState;
  risk: AgentState;
  reporter: AgentState;
}

export interface AgentState {
  status: 'idle' | 'running' | 'ok' | 'error';
  lastRun?: string;
  durationMs?: number;
  tokensUsed?: number;
  error?: string;
}
