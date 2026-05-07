import { prisma } from '../lib/prisma';
import { broadcastPositionClosed } from '../websocket';
import { getEquityCurrentPrice, getEquityOHLCV } from '../data/yahoo';
import { getCredential } from '../config/credentials';
import { NASDAQ_100 } from '../agents/discovery';

export interface ApprovedOrder {
  ticker: string;
  action: 'BUY' | 'SELL';
  trade_type: string;
  limit_price: number;
  stop_loss: number;
  take_profit: number;
  invalidation_condition: string;
  size_usd: number;
  confidence: number;
  debate_score: number;
  bull_conviction: number;
  bear_conviction: number;
  reasoning: string;
}

export interface ExecutionResult {
  order_id: string;
  ticker: string;
  action: string;
  filled_price: number;
  filled_qty: number;
  size_usd: number;
  timestamp: string;
  commission: number;
}

const MIN_ORDER_USD = 1;

/** Market-cap-aware slippage: large cap (NASDAQ 100) tight, EU mid wider, others mid. */
function getSlippageRange(ticker: string): [number, number] {
  if (ticker.includes(':')) {
    // EU listing — wider spread, less liquidity than US large caps
    return [0.0025, 0.0060]; // 0.25% – 0.60%
  }
  if (NASDAQ_100.includes(ticker)) {
    return [0.0005, 0.0015]; // 0.05% – 0.15%
  }
  return [0.0015, 0.0035]; // 0.15% – 0.35% (US mid / other)
}

function applySlippage(price: number, action: 'BUY' | 'SELL', ticker: string): number {
  const [low, high] = getSlippageRange(ticker);
  const slippagePct = low + Math.random() * (high - low);
  return action === 'BUY' ? price * (1 + slippagePct) : price * (1 - slippagePct);
}

async function simulateLatency(): Promise<void> {
  const ms = 100 + Math.random() * 400;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeOrder(order: ApprovedOrder): Promise<ExecutionResult> {
  await simulateLatency();

  const portfolioUsdRaw = await getCredential('portfolio_usd', 'PORTFOLIO_USD');
  const portfolioUsd = parseFloat(portfolioUsdRaw || '10000');
  const state = await getPortfolioState(Number.isFinite(portfolioUsd) ? portfolioUsd : 10000);
  const executableSizeUsd = order.action === 'BUY'
    ? Math.min(order.size_usd, Math.max(0, state.cash_usd))
    : order.size_usd;

  if (order.action === 'BUY' && executableSizeUsd < MIN_ORDER_USD) {
    throw new Error(`Insufficient cash for ${order.ticker}: available $${state.cash_usd.toFixed(2)}, requested $${order.size_usd.toFixed(2)}`);
  }

  if (order.action === 'BUY' && executableSizeUsd < order.size_usd) {
    console.warn(`[Broker] ${order.ticker}: reducing order from $${order.size_usd.toFixed(2)} to available cash $${executableSizeUsd.toFixed(2)}`);
  }

  const filledPrice = applySlippage(order.limit_price, order.action, order.ticker);
  const filledQty = executableSizeUsd / filledPrice;
  const commission = executableSizeUsd * 0.001;
  const orderId = `MOCK-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  await prisma.trade.create({
    data: {
      id: orderId,
      ticker: order.ticker,
      action: order.action,
      tradeType: order.trade_type,
      filledPrice,
      quantity: filledQty,
      sizeUsd: executableSizeUsd,
      stopLoss: order.stop_loss,
      takeProfit: order.take_profit,
      invalidationCondition: order.invalidation_condition,
      confidence: order.confidence,
      debateScore: order.debate_score,
      bullConviction: order.bull_conviction,
      bearConviction: order.bear_conviction,
      reasoning: order.reasoning,
      mock: true,
    },
  });

  console.log(
    JSON.stringify({
      event: 'order_executed',
      order_id: orderId,
      ticker: order.ticker,
      action: order.action,
      filled_price: filledPrice,
      size_usd: executableSizeUsd,
      commission,
    })
  );

  return {
    order_id: orderId,
    ticker: order.ticker,
    action: order.action,
    filled_price: filledPrice,
    filled_qty: filledQty,
    size_usd: executableSizeUsd,
    timestamp: new Date().toISOString(),
    commission,
  };
}

/**
 * Chandelier exit + extended stop ladder.
 *
 * Stop ladder (R = filledPrice - originalStop):
 *   gain ≥ +1R → stop = breakeven
 *   gain ≥ +2R → stop = +1R
 *   gain ≥ +3R → stop = +2R
 *   gain ≥ +4R → stop = +3R (continues laddering)
 *
 * Chandelier exit (replaces fixed take-profit once gain ≥ +2R):
 *   trailingTP = max(close since entry) - 3 × ATR(14, 4h)
 *   When current price falls below trailingTP, close — captures extended trends.
 *
 * Original take-profit still triggers if hit before +2R is reached.
 */
async function getChandelierExit(ticker: string, entryTime: Date): Promise<{ maxClose: number; atr: number } | null> {
  try {
    const bars = await getEquityOHLCV(ticker, '4h');
    if (bars.length < 14) return null;
    const sinceEntry = bars.filter((b) => new Date(b.time).getTime() >= entryTime.getTime());
    if (sinceEntry.length < 2) return null;
    const maxClose = Math.max(...sinceEntry.map((b) => b.close));
    // ATR(14) approximation: average of true ranges over last 14 bars
    const last14 = bars.slice(-14);
    const atrSum = last14.slice(1).reduce((sum, b, i) => {
      const prev = last14[i].close;
      const tr = Math.max(b.high - b.low, Math.abs(b.high - prev), Math.abs(b.low - prev));
      return sum + tr;
    }, 0);
    const atr = atrSum / Math.max(1, last14.length - 1);
    return { maxClose, atr };
  } catch {
    return null;
  }
}

export async function markToMarket(): Promise<void> {
  const openTrades = await prisma.trade.findMany({
    where: { closedAt: null, action: 'BUY' },
  });

  for (const trade of openTrades) {
    const currentPrice = await getEquityCurrentPrice(trade.ticker);
    if (!currentPrice) continue;

    const riskDistance = trade.filledPrice - trade.stopLoss;
    const gain = currentPrice - trade.filledPrice;
    let newStop = trade.stopLoss;

    // Extended stop ladder: BE → +1R → +2R → +3R → +4R...
    if (riskDistance > 0 && gain > 0) {
      const rMultiple = Math.floor(gain / riskDistance);
      if (rMultiple >= 1) {
        const stopRMultiple = rMultiple - 1; // gain at +NR → stop at +(N-1)R
        const candidateStop = trade.filledPrice + stopRMultiple * riskDistance;
        if (candidateStop > newStop) newStop = candidateStop;
      }
    }

    // Chandelier exit: once we have +2R, trail by max(close) - 3×ATR
    if (riskDistance > 0 && gain >= 2 * riskDistance) {
      const ce = await getChandelierExit(trade.ticker, trade.createdAt);
      if (ce) {
        const chandelierStop = ce.maxClose - 3 * ce.atr;
        // Only ratchet up — never lower the chandelier stop
        if (chandelierStop > newStop) newStop = chandelierStop;
      }
    }

    if (newStop > trade.stopLoss) {
      await prisma.trade.update({
        where: { id: trade.id },
        data: { stopLoss: newStop },
      });
      console.log(`[Broker] Stop ladder ${trade.ticker}: ${trade.stopLoss.toFixed(2)} → ${newStop.toFixed(2)} (gain ${(gain / riskDistance).toFixed(1)}R)`);
    }

    if (currentPrice <= newStop) {
      await closeTrade(trade.id, currentPrice, gain > 0 ? 'TRAIL' : 'SL');
      continue;
    }

    // Original fixed TP only triggers if gain still < 2R (chandelier takes over after that)
    if (gain < 2 * riskDistance && currentPrice >= trade.takeProfit) {
      await closeTrade(trade.id, currentPrice, 'TP');
    }
  }
}

export async function closeTrade(
  tradeId: string,
  closePrice: number,
  reason: string
): Promise<void> {
  const trade = await prisma.trade.findUnique({ where: { id: tradeId } });
  if (!trade) return;

  const pnlUsd = (closePrice - trade.filledPrice) * trade.quantity;
  await prisma.trade.update({
    where: { id: tradeId },
    data: {
      closedAt: new Date(),
      closePrice,
      pnlUsd,
      closeReason: reason,
    },
  });

  broadcastPositionClosed(trade.ticker, pnlUsd, reason);
}

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
  days_held?: number;
  entry_conviction?: number;
}

export async function getPortfolioState(portfolioUsd: number): Promise<{
  total_usd: number;
  cash_usd: number;
  daily_pnl_pct: number;
  risk_regime: string;
  initial_capital: number;
  equity_peak: number;
  drawdown_from_peak_pct: number;
  positions: Position[];
}> {
  const openTrades = await prisma.trade.findMany({ where: { closedAt: null, action: 'BUY' } });
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const todayTrades = await prisma.trade.findMany({
    where: { closedAt: { gte: today }, pnlUsd: { not: null } },
  });

  const realizedDailyPnl = todayTrades.reduce((sum, t) => sum + (t.pnlUsd || 0), 0);

  // Calculate realized P&L from all closed trades to get actual capital
  const closedTrades = await prisma.trade.findMany({ where: { closedAt: { not: null }, pnlUsd: { not: null } } });
  const realizedPnl = closedTrades.reduce((sum, t) => sum + (t.pnlUsd || 0), 0);
  const actualCapital = portfolioUsd + realizedPnl;

  const investedUsd = openTrades.reduce((sum, t) => sum + t.sizeUsd, 0);
  const cashUsd = actualCapital - investedUsd;

  const nowMs = Date.now();
  const positions: Position[] = await Promise.all(
    openTrades.map(async (t) => {
      const fetchedPrice = await getEquityCurrentPrice(t.ticker);
      const cp = fetchedPrice || t.filledPrice;
      const pnlUsd = (cp - t.filledPrice) * t.quantity;
      const daysHeld = (nowMs - new Date(t.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      return {
        ticker: t.ticker,
        quantity: t.quantity,
        entryPrice: t.filledPrice,
        currentPrice: cp,
        sizeUsd: t.sizeUsd,
        pnlUsd,
        pnlPct: (pnlUsd / t.sizeUsd) * 100,
        stopLoss: t.stopLoss,
        takeProfit: t.takeProfit,
        days_held: Math.floor(daysHeld * 10) / 10,
        entry_conviction: t.confidence,
      };
    })
  );

  // P&L journalier = trades fermés aujourd'hui + unrealized sur positions ouvertes
  const unrealizedPnl = positions.reduce((s, p) => s + p.pnlUsd, 0);
  const dailyPnl = realizedDailyPnl + unrealizedPnl;

  const totalUsd = cashUsd + positions.reduce((s, p) => s + p.sizeUsd + p.pnlUsd, 0);
  const dailyPnlPct = (dailyPnl / actualCapital) * 100;

  // Drawdown from equity peak
  const equityPeak = await getEquityPeak(portfolioUsd);
  const drawdownPct = equityPeak > 0 ? ((totalUsd - equityPeak) / equityPeak) * 100 : 0;

  let risk_regime = 'NORMAL';
  if (dailyPnlPct <= -2) risk_regime = 'ELEVATED';
  if (dailyPnlPct <= -3) risk_regime = 'CRISIS';
  if (drawdownPct <= -10) risk_regime = 'DRAWDOWN';
  if (drawdownPct <= -15) risk_regime = 'SEVERE_DRAWDOWN';

  return {
    total_usd: totalUsd,
    cash_usd: cashUsd,
    daily_pnl_pct: dailyPnlPct,
    risk_regime,
    initial_capital: portfolioUsd,
    equity_peak: equityPeak,
    drawdown_from_peak_pct: drawdownPct,
    positions,
  };
}

/** Track highest equity value in DB for drawdown-from-peak calculation */
async function getEquityPeak(initialCapital: number): Promise<number> {
  const existing = await prisma.config.findUnique({ where: { key: 'equity_peak' } });
  const currentPeak = existing ? parseFloat(existing.value) : initialCapital;
  return currentPeak;
}

/** Update equity peak if current value is higher */
export async function updateEquityPeak(currentTotalUsd: number): Promise<void> {
  const existing = await prisma.config.findUnique({ where: { key: 'equity_peak' } });
  const currentPeak = existing ? parseFloat(existing.value) : 0;
  if (currentTotalUsd > currentPeak) {
    await prisma.config.upsert({
      where: { key: 'equity_peak' },
      update: { value: currentTotalUsd.toString() },
      create: { key: 'equity_peak', value: currentTotalUsd.toString() },
    });
  }
}
