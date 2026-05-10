import axios from 'axios';
import { prisma } from '../lib/prisma';
import { broadcastPositionClosed } from '../websocket';
import type { ApprovedOrder, ExecutionResult, Position } from './mock';

function getAlpacaConfig(): { key: string; secret: string; baseUrl: string } {
  const key = process.env.ALPACA_KEY ?? '';
  const secret = process.env.ALPACA_SECRET ?? '';
  const baseUrl = process.env.ALPACA_BASE_URL ?? 'https://paper-api.alpaca.markets';
  if (!key || !secret) throw new Error('ALPACA_KEY et ALPACA_SECRET requis (BROKER_TYPE=alpaca)');
  return { key, secret, baseUrl };
}

function alpacaHeaders(key: string, secret: string): Record<string, string> {
  return {
    'APCA-API-KEY-ID': key,
    'APCA-API-SECRET-KEY': secret,
    'Content-Type': 'application/json',
  };
}

// Alpaca = US stocks uniquement. EU tickers (TICKER:XETR etc.) non supportés.
function toAlpacaSymbol(ticker: string): string {
  if (ticker.includes(':')) {
    throw new Error(`Alpaca ne supporte pas les tickers EU: ${ticker}`);
  }
  return ticker;
}

export async function executeAlpacaOrder(order: ApprovedOrder): Promise<ExecutionResult> {
  const { key, secret, baseUrl } = getAlpacaConfig();
  const headers = alpacaHeaders(key, secret);
  const symbol = toAlpacaSymbol(order.ticker);

  const qtyRaw = order.size_usd / order.limit_price;
  const qty = Math.floor(qtyRaw * 1000) / 1000;
  if (qty <= 0) throw new Error(`Quantité trop petite: ${qty} pour ${symbol}`);

  let body: Record<string, unknown>;

  if (order.action === 'BUY') {
    body = {
      symbol,
      qty: qty.toString(),
      side: 'buy',
      type: 'market',
      time_in_force: 'day',
      order_class: 'bracket',
      stop_loss: { stop_price: order.stop_loss.toFixed(2) },
      take_profit: { limit_price: order.take_profit.toFixed(2) },
    };
  } else {
    body = {
      symbol,
      qty: qty.toString(),
      side: 'sell',
      type: 'market',
      time_in_force: 'day',
    };
  }

  const res = await axios.post(`${baseUrl}/v2/orders`, body, {
    headers,
    timeout: 10_000,
  });

  const filled = res.data;
  const filledPrice = parseFloat(filled.filled_avg_price ?? order.limit_price.toString());
  const filledQty = parseFloat(filled.filled_qty ?? qty.toString());
  const sizeUsd = filledQty * filledPrice;
  const orderId = `ALPACA-${filled.id}`;

  await prisma.trade.create({
    data: {
      id: orderId,
      ticker: order.ticker,
      action: order.action,
      tradeType: order.trade_type,
      filledPrice,
      quantity: filledQty,
      sizeUsd,
      stopLoss: order.stop_loss,
      takeProfit: order.take_profit,
      invalidationCondition: order.invalidation_condition,
      confidence: order.confidence,
      debateScore: order.debate_score,
      bullConviction: order.bull_conviction,
      bearConviction: order.bear_conviction,
      reasoning: order.reasoning,
      mock: false,
    },
  });

  console.log(JSON.stringify({
    event: 'order_executed',
    broker: 'alpaca',
    order_id: orderId,
    ticker: order.ticker,
    action: order.action,
    filled_price: filledPrice,
    size_usd: sizeUsd,
  }));

  return {
    order_id: orderId,
    ticker: order.ticker,
    action: order.action,
    filled_price: filledPrice,
    filled_qty: filledQty,
    size_usd: sizeUsd,
    timestamp: new Date().toISOString(),
    commission: 0, // Alpaca = zéro commission
  };
}

export interface AlpacaAccount {
  equity: number;
  cash: number;
  portfolio_value: number;
  buying_power: number;
}

export async function getAlpacaAccount(): Promise<AlpacaAccount> {
  const { key, secret, baseUrl } = getAlpacaConfig();
  const res = await axios.get(`${baseUrl}/v2/account`, {
    headers: alpacaHeaders(key, secret),
    timeout: 8_000,
  });
  const d = res.data;
  return {
    equity: parseFloat(d.equity),
    cash: parseFloat(d.cash),
    portfolio_value: parseFloat(d.portfolio_value),
    buying_power: parseFloat(d.buying_power),
  };
}

export async function getAlpacaPositions(): Promise<Position[]> {
  const { key, secret, baseUrl } = getAlpacaConfig();
  const res = await axios.get(`${baseUrl}/v2/positions`, {
    headers: alpacaHeaders(key, secret),
    timeout: 8_000,
  });
  return (res.data as Record<string, string>[]).map((p) => ({
    ticker: p.symbol,
    quantity: parseFloat(p.qty),
    entryPrice: parseFloat(p.avg_entry_price),
    currentPrice: parseFloat(p.current_price),
    sizeUsd: parseFloat(p.market_value),
    pnlUsd: parseFloat(p.unrealized_pl),
    pnlPct: parseFloat(p.unrealized_plpc) * 100,
    stopLoss: 0,
    takeProfit: 0,
  }));
}

export async function closeAlpacaPosition(symbol: string): Promise<void> {
  const { key, secret, baseUrl } = getAlpacaConfig();
  await axios.delete(`${baseUrl}/v2/positions/${toAlpacaSymbol(symbol)}`, {
    headers: alpacaHeaders(key, secret),
    timeout: 8_000,
  });

  const trade = await prisma.trade.findFirst({
    where: { ticker: symbol, closedAt: null, action: 'BUY', mock: false },
  });
  if (trade) {
    await prisma.trade.update({
      where: { id: trade.id },
      data: { closedAt: new Date(), closeReason: 'ALPACA_FORCE_CLOSE' },
    });
    broadcastPositionClosed(symbol, 0, 'ALPACA_FORCE_CLOSE');
  }
}

export async function cancelAllAlpacaOrders(): Promise<void> {
  const { key, secret, baseUrl } = getAlpacaConfig();
  await axios.delete(`${baseUrl}/v2/orders`, {
    headers: alpacaHeaders(key, secret),
    timeout: 8_000,
  });
}
