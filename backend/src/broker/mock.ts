import { prisma } from '../lib/prisma';
import { broadcastPositionClosed } from '../websocket';
import { getCurrentPrice } from '../data/alphavantage';

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

function applySlippage(price: number, action: 'BUY' | 'SELL'): number {
  // Realistic slippage: 0.10-0.30% random, simulates market impact + spread
  const slippagePct = 0.001 + Math.random() * 0.002;
  return action === 'BUY' ? price * (1 + slippagePct) : price * (1 - slippagePct);
}

async function simulateLatency(): Promise<void> {
  const ms = 100 + Math.random() * 400;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeOrder(order: ApprovedOrder): Promise<ExecutionResult> {
  await simulateLatency();

  const filledPrice = applySlippage(order.limit_price, order.action);
  const filledQty = order.size_usd / filledPrice;
  const commission = order.size_usd * 0.001;
  const orderId = `MOCK-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  await prisma.trade.create({
    data: {
      id: orderId,
      ticker: order.ticker,
      action: order.action,
      tradeType: order.trade_type,
      filledPrice,
      quantity: filledQty,
      sizeUsd: order.size_usd,
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
      size_usd: order.size_usd,
      commission,
    })
  );

  return {
    order_id: orderId,
    ticker: order.ticker,
    action: order.action,
    filled_price: filledPrice,
    filled_qty: filledQty,
    size_usd: order.size_usd,
    timestamp: new Date().toISOString(),
    commission,
  };
}

export async function markToMarket(): Promise<void> {
  const openTrades = await prisma.trade.findMany({
    where: { closedAt: null, action: 'BUY' },
  });

  for (const trade of openTrades) {
    const currentPrice = await getCurrentPrice(trade.ticker);
    if (!currentPrice) continue;

    // Trailing stop logic — déplacer le stop selon progression
    const riskDistance = trade.filledPrice - trade.stopLoss;
    const gain = currentPrice - trade.filledPrice;
    let newStop = trade.stopLoss;

    if (riskDistance > 0) {
      if (gain >= 2 * riskDistance) {
        // +2R atteint → stop à +1R (lock profit)
        newStop = Math.max(trade.stopLoss, trade.filledPrice + riskDistance);
      } else if (gain >= riskDistance) {
        // +1R atteint → stop au break-even
        newStop = Math.max(trade.stopLoss, trade.filledPrice);
      }

      if (newStop > trade.stopLoss) {
        await prisma.trade.update({
          where: { id: trade.id },
          data: { stopLoss: newStop },
        });
        console.log(`[Broker] Trailing stop ${trade.ticker}: ${trade.stopLoss.toFixed(2)} → ${newStop.toFixed(2)}`);
      }
    }

    // Check stop loss (against updated stop)
    if (currentPrice <= newStop) {
      await closeTrade(trade.id, currentPrice, 'SL');
      continue;
    }

    // Check take profit
    if (currentPrice >= trade.takeProfit) {
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

export async function getPortfolioState(portfolioUsd: number): Promise<{
  total_usd: number;
  cash_usd: number;
  daily_pnl_pct: number;
  risk_regime: string;
  initial_capital: number;
  equity_peak: number;
  drawdown_from_peak_pct: number;
  positions: Array<{
    ticker: string;
    quantity: number;
    entryPrice: number;
    currentPrice: number;
    sizeUsd: number;
    pnlUsd: number;
    pnlPct: number;
    stopLoss: number;
    takeProfit: number;
  }>;
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

  const positions = await Promise.all(
    openTrades.map(async (t) => {
      const cp = (await getCurrentPrice(t.ticker)) || t.filledPrice;
      const pnlUsd = (cp - t.filledPrice) * t.quantity;
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
