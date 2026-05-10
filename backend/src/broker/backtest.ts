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

function calcSharpe(pnls: number[]): number {
  if (pnls.length < 2) return 0;
  const avg = pnls.reduce((s, p) => s + p, 0) / pnls.length;
  const std = Math.sqrt(pnls.reduce((s, p) => s + (p - avg) ** 2, 0) / (pnls.length - 1));
  return std > 0 ? (avg / std) * Math.sqrt(252) : 0;
}

function calcProfitFactor(pnls: number[]): number {
  const gross = pnls.filter((p) => p > 0).reduce((s, p) => s + p, 0);
  const loss = Math.abs(pnls.filter((p) => p <= 0).reduce((s, p) => s + p, 0));
  if (loss === 0) return gross > 0 ? Infinity : 0;
  return gross / loss;
}

export interface DecayResult {
  recent_win_rate: number;
  historical_win_rate: number;
  recent_sharpe: number;
  historical_sharpe: number;
  recent_profit_factor: number;
  historical_profit_factor: number;
  decay_detected: boolean;
  decay_reasons: string[];
  message: string;
}

/**
 * Détecte le decay de stratégie sur 3 métriques :
 * - Win rate (récent < 50% historique)
 * - Sharpe (récent < 0 quand historique > 0.5)
 * - Profit factor (récent < 1.0 quand historique > 1.5)
 */
export async function detectStrategyDecay(): Promise<DecayResult> {
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
      recent_sharpe: 0,
      historical_sharpe: 0,
      recent_profit_factor: 0,
      historical_profit_factor: 0,
      decay_detected: false,
      decay_reasons: [],
      message: 'Pas assez de trades pour détecter le decay (minimum 10)',
    };
  }

  const recentPnls = recentTrades.map((t) => t.pnlUsd ?? 0);
  const histPnls = historicalTrades.map((t) => t.pnlUsd ?? 0);

  const recentWinRate = recentPnls.filter((p) => p > 0).length / recentPnls.length;
  const historicalWinRate = histPnls.length > 0
    ? histPnls.filter((p) => p > 0).length / histPnls.length
    : recentWinRate;

  const recentSharpe = calcSharpe(recentPnls);
  const historicalSharpe = histPnls.length > 1 ? calcSharpe(histPnls) : recentSharpe;

  const recentPF = calcProfitFactor(recentPnls);
  const historicalPF = histPnls.length > 0 ? calcProfitFactor(histPnls) : recentPF;

  // 3 conditions de decay indépendantes
  const winRateDecay = historicalWinRate > 0 && recentWinRate < historicalWinRate * 0.5;
  const sharpeDecay = historicalSharpe > 0.5 && recentSharpe < 0;
  const pfDecay = isFinite(historicalPF) && historicalPF > 1.5 && isFinite(recentPF) && recentPF < 1.0;

  const decayDetected = winRateDecay || sharpeDecay || pfDecay;

  const decayReasons: string[] = [];
  if (winRateDecay) decayReasons.push(`win rate ${(recentWinRate * 100).toFixed(1)}% vs ${(historicalWinRate * 100).toFixed(1)}% hist`);
  if (sharpeDecay) decayReasons.push(`Sharpe ${recentSharpe.toFixed(2)} vs ${historicalSharpe.toFixed(2)} hist`);
  if (pfDecay) decayReasons.push(`profit factor ${recentPF.toFixed(2)} vs ${historicalPF.toFixed(2)} hist`);

  return {
    recent_win_rate: recentWinRate,
    historical_win_rate: historicalWinRate,
    recent_sharpe: recentSharpe,
    historical_sharpe: historicalSharpe,
    recent_profit_factor: recentPF,
    historical_profit_factor: historicalPF,
    decay_detected: decayDetected,
    decay_reasons: decayReasons,
    message: decayDetected
      ? `STRATEGY DECAY: ${decayReasons.join(' | ')}`
      : `Stratégie saine: WR=${(recentWinRate * 100).toFixed(1)}% Sharpe=${recentSharpe.toFixed(2)} PF=${isFinite(recentPF) ? recentPF.toFixed(2) : '∞'}`,
  };
}

// ─── Walk-forward backtest ────────────────────────────────────────────────────

export interface WalkForwardWindow {
  train_start: string;
  train_end: string;
  test_start: string;
  test_end: string;
  train_result: BacktestResult;
  test_result: BacktestResult;
}

export interface WalkForwardResult {
  windows: WalkForwardWindow[];
  overall_test_sharpe: number;
  overall_test_win_rate: number;
  overall_test_profit_factor: number;
  /** train_sharpe / test_sharpe moyen — ratio > 2 = risque d'overfitting */
  degradation_ratio: number;
  overfitting_warning: boolean;
}

/**
 * Walk-forward backtest: découpe les bars en fenêtres roulantes train/test.
 * Valide si la stratégie se comporte de façon cohérente hors-échantillon.
 *
 * @param trainDays  Barres dans la fenêtre d'entraînement (défaut: 90)
 * @param testDays   Barres dans la fenêtre de test (défaut: 30)
 */
export function runWalkForwardBacktest(
  bars: BacktestBar[],
  orders: ApprovedOrder[],
  initialCapital: number,
  trainDays = 90,
  testDays = 30
): WalkForwardResult {
  const windows: WalkForwardWindow[] = [];
  const windowSize = trainDays + testDays;

  // Avance par testDays à chaque itération (walk-forward anchored rolling)
  for (let start = 0; start + windowSize <= bars.length; start += testDays) {
    const trainBars = bars.slice(start, start + trainDays);
    const testBars = bars.slice(start + trainDays, start + windowSize);

    if (trainBars.length < 20 || testBars.length < 5) break;

    const trainResult = runBacktest(trainBars, orders, initialCapital);
    const testResult = runBacktest(testBars, orders, initialCapital);

    windows.push({
      train_start: trainBars[0].time,
      train_end: trainBars[trainBars.length - 1].time,
      test_start: testBars[0].time,
      test_end: testBars[testBars.length - 1].time,
      train_result: trainResult,
      test_result: testResult,
    });
  }

  if (windows.length === 0) {
    return {
      windows: [],
      overall_test_sharpe: 0,
      overall_test_win_rate: 0,
      overall_test_profit_factor: 0,
      degradation_ratio: 0,
      overfitting_warning: false,
    };
  }

  const n = windows.length;
  const avgTestSharpe = windows.reduce((s, w) => s + w.test_result.sharpe_ratio, 0) / n;
  const avgTrainSharpe = windows.reduce((s, w) => s + w.train_result.sharpe_ratio, 0) / n;
  const avgTestWinRate = windows.reduce((s, w) => s + w.test_result.win_rate, 0) / n;
  const avgTestPF = windows.reduce((s, w) => {
    const pf = w.test_result.profit_factor;
    return s + (isFinite(pf) ? pf : 0);
  }, 0) / n;

  const degradationRatio = avgTestSharpe > 0.01
    ? avgTrainSharpe / avgTestSharpe
    : avgTrainSharpe > 0 ? 99 : 0;

  return {
    windows,
    overall_test_sharpe: avgTestSharpe,
    overall_test_win_rate: avgTestWinRate,
    overall_test_profit_factor: avgTestPF,
    degradation_ratio: degradationRatio,
    overfitting_warning: degradationRatio > 2,
  };
}