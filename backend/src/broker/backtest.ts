import { prisma } from '../lib/prisma';
import type { ApprovedOrder } from './mock';

export interface BacktestBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BacktestTrade {
  ticker: string;
  action: 'BUY' | 'SELL';
  entry_price: number;
  exit_price: number;
  exit_reason: 'TP' | 'SL' | 'EXIT';
  size_usd: number;
  pnl_usd: number;
  pnl_pct: number;
  trade_type: string;
  confidence: number;
  entry_time: string;
  exit_time: string;
  hold_bars: number;
}

export interface BacktestResult {
  total_trades: number;
  win_rate: number;
  avg_pnl_pct: number;
  total_pnl_usd: number;
  max_drawdown_pct: number;
  sharpe_ratio: number;
  profit_factor: number;
  trades: BacktestTrade[];
  equity_curve: number[];
  by_type: Record<string, { trades: number; win_rate: number; avg_pnl: number }>;
}

/**
 * Run a simple backtest using historical OHLCV bars.
 * Simulates stop-loss and take-profit on each bar.
 */
export function runBacktest(
  bars: BacktestBar[],
  orders: ApprovedOrder[],
  initialCapital: number
): BacktestResult {
  const trades: BacktestTrade[] = [];
  let capital = initialCapital;
  const equityCurve: number[] = [initialCapital];
  const openPositions: Map<string, {
    order: ApprovedOrder;
    entryPrice: number;
    entryTime: string;
    entryBar: number;
    quantity: number;
  }> = new Map();

  // Group bars by index for simulation
  for (let barIdx = 0; barIdx < bars.length; barIdx++) {
    const bar = bars[barIdx];

    // Check existing positions for SL/TP
    for (const [ticker, pos] of openPositions) {
      // Check stop loss (low touches stop)
      if (bar.low <= pos.order.stop_loss) {
        const exitPrice = Math.max(pos.order.stop_loss, bar.open);
        const pnl = (exitPrice - pos.entryPrice) * pos.quantity;
        capital += pos.quantity * pos.entryPrice + pnl;
        trades.push({
          ticker,
          action: pos.order.action,
          entry_price: pos.entryPrice,
          exit_price: exitPrice,
          exit_reason: 'SL',
          size_usd: pos.order.size_usd,
          pnl_usd: pnl,
          pnl_pct: (pnl / pos.order.size_usd) * 100,
          trade_type: pos.order.trade_type,
          confidence: pos.order.confidence,
          entry_time: pos.entryTime,
          exit_time: bar.time,
          hold_bars: barIdx - pos.entryBar,
        });
        openPositions.delete(ticker);
        continue;
      }

      // Check take profit (high touches target)
      if (bar.high >= pos.order.take_profit) {
        const exitPrice = Math.min(pos.order.take_profit, bar.open + pos.order.take_profit * 0.001);
        const pnl = (exitPrice - pos.entryPrice) * pos.quantity;
        capital += pos.quantity * pos.entryPrice + pnl;
        trades.push({
          ticker,
          action: pos.order.action,
          entry_price: pos.entryPrice,
          exit_price: exitPrice,
          exit_reason: 'TP',
          size_usd: pos.order.size_usd,
          pnl_usd: pnl,
          pnl_pct: (pnl / pos.order.size_usd) * 100,
          trade_type: pos.order.trade_type,
          confidence: pos.order.confidence,
          entry_time: pos.entryTime,
          exit_time: bar.time,
          hold_bars: barIdx - pos.entryBar,
        });
        openPositions.delete(ticker);
        continue;
      }
    }

    // Open new positions at bar close for matching orders
    for (const order of orders) {
      if (openPositions.has(order.ticker)) continue;
      // Check if bar close is near order entry price (within 0.5%)
      if (Math.abs(bar.close - order.limit_price) / order.limit_price < 0.005) {
        const quantity = order.size_usd / bar.close;
        capital -= order.size_usd;
        openPositions.set(order.ticker, {
          order,
          entryPrice: bar.close,
          entryTime: bar.time,
          entryBar: barIdx,
          quantity,
        });
      }
    }

    // Track equity
    let unrealizedPnl = 0;
    for (const [, pos] of openPositions) {
      unrealizedPnl += (bar.close - pos.entryPrice) * pos.quantity;
    }
    equityCurve.push(capital + unrealizedPnl);
  }

  // Close remaining positions at last bar
  const lastBar = bars[bars.length - 1];
  for (const [ticker, pos] of openPositions) {
    const pnl = (lastBar.close - pos.entryPrice) * pos.quantity;
    capital += pos.quantity * pos.entryPrice + pnl;
    trades.push({
      ticker,
      action: pos.order.action,
      entry_price: pos.entryPrice,
      exit_price: lastBar.close,
      exit_reason: 'EXIT',
      size_usd: pos.order.size_usd,
      pnl_usd: pnl,
      pnl_pct: (pnl / pos.order.size_usd) * 100,
      trade_type: pos.order.trade_type,
      confidence: pos.order.confidence,
      entry_time: pos.entryTime,
      exit_time: lastBar.time,
      hold_bars: bars.length - 1 - pos.entryBar,
    });
  }
  openPositions.clear();

  // Calculate stats
  const wins = trades.filter((t) => t.pnl_usd > 0);
  const winRate = trades.length > 0 ? wins.length / trades.length : 0;
  const avgPnl = trades.length > 0 ? trades.reduce((s, t) => s + t.pnl_pct, 0) / trades.length : 0;
  const totalPnl = capital - initialCapital;

  // Max drawdown from equity curve
  let peak = initialCapital;
  let maxDrawdown = 0;
  for (const eq of equityCurve) {
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak * 100;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // Sharpe ratio (annualized)
  const returns = equityCurve.slice(1).map((eq, i) => (eq - equityCurve[i]) / equityCurve[i]);
  const avgReturn = returns.length > 0 ? returns.reduce((s, r) => s + r, 0) / returns.length : 0;
  const stdReturn = returns.length > 1
    ? Math.sqrt(returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / (returns.length - 1))
    : 1;
  const sharpe = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;

  // Profit factor
  const grossProfit = wins.reduce((s, t) => s + t.pnl_usd, 0);
  const losses = trades.filter((t) => t.pnl_usd <= 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl_usd, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // Stats by trade type
  const byType: Record<string, { trades: number; win_rate: number; avg_pnl: number }> = {};
  for (const t of trades) {
    if (!byType[t.trade_type]) byType[t.trade_type] = { trades: 0, win_rate: 0, avg_pnl: 0 };
    byType[t.trade_type].trades++;
    if (t.pnl_usd > 0) byType[t.trade_type].win_rate++;
    byType[t.trade_type].avg_pnl += t.pnl_pct;
  }
  for (const key of Object.keys(byType)) {
    const bt = byType[key];
    bt.win_rate = bt.trades > 0 ? bt.win_rate / bt.trades : 0;
    bt.avg_pnl = bt.trades > 0 ? bt.avg_pnl / bt.trades : 0;
  }

  return {
    total_trades: trades.length,
    win_rate: winRate,
    avg_pnl_pct: avgPnl,
    total_pnl_usd: totalPnl,
    max_drawdown_pct: maxDrawdown,
    sharpe_ratio: sharpe,
    profit_factor: profitFactor,
    trades,
    equity_curve: equityCurve,
    by_type: byType,
  };
}

/**
 * Track strategy performance for decay detection.
 * Compares recent performance (last 30 trades) vs historical performance.
 */
export async function detectStrategyDecay(): Promise<{
  recent_win_rate: number;
  historical_win_rate: number;
  decay_detected: boolean;
  recent_sharpe: number;
  message: string;
}> {
  const recentTrades = await prisma.trade.findMany({
    where: { closedAt: { not: null }, pnlUsd: { not: null } },
    orderBy: { closedAt: 'desc' },
    take: 30,
  });

  const historicalTrades = await prisma.trade.findMany({
    where: { closedAt: { not: null }, pnlUsd: { not: null } },
    orderBy: { closedAt: 'desc' },
    skip: 30,
    take: 60,
  });

  if (recentTrades.length < 10) {
    return {
      recent_win_rate: 0,
      historical_win_rate: 0,
      decay_detected: false,
      recent_sharpe: 0,
      message: 'Pas assez de trades pour détecter le decay',
    };
  }

  const recentWinRate = recentTrades.filter((t) => (t.pnlUsd ?? 0) > 0).length / recentTrades.length;
  const recentAvgPnl = recentTrades.reduce((s, t) => s + (t.pnlUsd ?? 0), 0) / recentTrades.length;

  const historicalWinRate = historicalTrades.length > 0
    ? historicalTrades.filter((t) => (t.pnlUsd ?? 0) > 0).length / historicalTrades.length
    : recentWinRate;

  // Decay: recent performance < 50% of historical
  const decayDetected = historicalWinRate > 0 && recentWinRate < historicalWinRate * 0.5;

  // Simple Sharpe approximation from recent PnLs
  const pnls = recentTrades.map((t) => t.pnlUsd ?? 0);
  const avgPnl = pnls.reduce((s, p) => s + p, 0) / pnls.length;
  const stdPnl = pnls.length > 1
    ? Math.sqrt(pnls.reduce((s, p) => s + (p - avgPnl) ** 2, 0) / (pnls.length - 1))
    : 1;
  const recentSharpe = stdPnl > 0 ? (avgPnl / stdPnl) * Math.sqrt(252) : 0;

  return {
    recent_win_rate: recentWinRate,
    historical_win_rate: historicalWinRate,
    decay_detected: decayDetected,
    recent_sharpe: recentSharpe,
    message: decayDetected
      ? `STRATEGY DECAY: win rate ${(recentWinRate * 100).toFixed(1)}% vs ${(historicalWinRate * 100).toFixed(1)}% historical`
      : `Strategy healthy: ${(recentWinRate * 100).toFixed(1)}% win rate`,
  };
}