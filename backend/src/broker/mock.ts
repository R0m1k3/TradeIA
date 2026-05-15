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

/** Market-cap-aware slippage, calibré pour conditions retail réalistes.
 * Inclut spread bid/ask + impact + bruit. Sous-estimer le slippage = backtest optimiste. */
function getSlippageRange(ticker: string): [number, number] {
  if (ticker.includes(':')) {
    // EU listing — wider spread, less liquidity than US large caps
    return [0.0050, 0.0120]; // 0.50% – 1.20%
  }
  if (NASDAQ_100.includes(ticker)) {
    return [0.0012, 0.0035]; // 0.12% – 0.35%
  }
  return [0.0030, 0.0070]; // 0.30% – 0.70% (US mid / other)
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

  // SELL ordre = fermer la position BUY existante sur ce ticker
  // (sinon le BUY reste éternellement ouvert et les stats sont faussées)
  if (order.action === 'SELL') {
    const openTrade = await prisma.trade.findFirst({
      where: { ticker: order.ticker, action: 'BUY', closedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!openTrade) {
      throw new Error(`SELL ${order.ticker}: aucune position BUY ouverte à fermer`);
    }

    const filledPrice = applySlippage(order.limit_price || (await getEquityCurrentPrice(order.ticker)) || openTrade.filledPrice, 'SELL', order.ticker);
    const commission = openTrade.sizeUsd * 0.001;
    const orderId = `MOCK-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    // Fermer le BUY original avec le pnl + reason "LLM_SELL"
    await closeTrade(openTrade.id, filledPrice, `LLM_SELL: ${order.reasoning?.slice(0, 80) || 'décision LLM'}`);

    console.log(
      JSON.stringify({
        event: 'order_executed',
        order_id: orderId,
        ticker: order.ticker,
        action: 'SELL',
        filled_price: filledPrice,
        size_usd: openTrade.sizeUsd,
        commission,
        closed_trade: openTrade.id,
      })
    );

    return {
      order_id: orderId,
      ticker: order.ticker,
      action: 'SELL',
      filled_price: filledPrice,
      filled_qty: openTrade.quantity,
      size_usd: openTrade.sizeUsd,
      timestamp: new Date().toISOString(),
      commission,
    };
  }

  // BUY: nouvelle position
  const portfolioUsdRaw = await getCredential('portfolio_usd', 'PORTFOLIO_USD');
  const portfolioUsd = parseFloat(portfolioUsdRaw || '10000');
  const state = await getPortfolioState(Number.isFinite(portfolioUsd) ? portfolioUsd : 10000);
  const executableSizeUsd = Math.min(order.size_usd, Math.max(0, state.cash_usd));

  if (executableSizeUsd < MIN_ORDER_USD) {
    throw new Error(`Insufficient cash for ${order.ticker}: available $${state.cash_usd.toFixed(2)}, requested $${order.size_usd.toFixed(2)}`);
  }

  if (executableSizeUsd < order.size_usd) {
    console.warn(`[Broker] ${order.ticker}: reducing order from $${order.size_usd.toFixed(2)} to available cash $${executableSizeUsd.toFixed(2)}`);
  }

  const filledPrice = applySlippage(order.limit_price, 'BUY', order.ticker);
  const filledQty = executableSizeUsd / filledPrice;
  const commission = executableSizeUsd * 0.001;
  const orderId = `MOCK-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  await prisma.trade.create({
    data: {
      id: orderId,
      ticker: order.ticker,
      action: 'BUY',
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
      action: 'BUY',
      filled_price: filledPrice,
      size_usd: executableSizeUsd,
      commission,
    })
  );

  return {
    order_id: orderId,
    ticker: order.ticker,
    action: 'BUY',
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
 *   gain ≥ +1.5R → stop = breakeven    (laisse respirer les pullbacks normaux)
 *   gain ≥ +2.5R → stop = +1R
 *   gain ≥ +3.5R → stop = +2R
 *   gain ≥ +4.5R → stop = +3R (continues laddering)
 *
 * Chandelier exit (replaces fixed take-profit once gain ≥ +3R):
 *   trailingTP = max(close since entry) - 4 × ATR(14, 4h)
 *   When current price falls below trailingTP, close — captures extended trends.
 *
 * Original take-profit still triggers if hit before +3R is reached.
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

    // Stop ladder décalé d'un demi-R : BE à +1.5R, +1R à +2.5R, +2R à +3.5R...
    // Évite de couper les gagnants sur un pullback normal de 0.5–1R.
    if (riskDistance > 0 && gain > 0) {
      const rGain = gain / riskDistance;
      if (rGain >= 1.5) {
        const stopRMultiple = Math.floor(rGain - 0.5) - 1; // 1.5R → 0R (BE), 2.5R → +1R, 3.5R → +2R...
        if (stopRMultiple >= 0) {
          const candidateStop = trade.filledPrice + stopRMultiple * riskDistance;
          if (candidateStop > newStop) newStop = candidateStop;
        }
      }
    }

    // Chandelier exit: once we have +3R, trail by max(close) - 4×ATR (was +2R / 3×ATR)
    // Plus large pour capturer les vraies tendances et éviter les sorties prématurées
    if (riskDistance > 0 && gain >= 3 * riskDistance) {
      const ce = await getChandelierExit(trade.ticker, trade.createdAt);
      if (ce) {
        const chandelierStop = ce.maxClose - 4 * ce.atr;
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
