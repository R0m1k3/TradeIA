import { callLLM, parseJsonResponse } from '../llm/client';
import { getModels } from '../llm/models';
import { buildRiskPrompt, RISK_SYSTEM } from '../prompts/risk.prompt';
import type { OrderProposal } from './strategist';
import type { ApprovedOrder } from '../broker/mock';
import type { TickerData } from './collector';
import type { Position } from '../broker/mock';
import { getTickerSector, countPositionsBySector } from '../data/sectors';
import { isMacroBlackout } from '../data/macro-events';
import { prisma } from '../lib/prisma';

const MAX_POSITIONS_PER_SECTOR = 3;
const MAX_SECTOR_NAV_PCT = 0.40;
const MIN_BUY_CONFIDENCE = 55;

/** Volatility targeting: contribute at most 1.5% annualized vol per slot. */
const VOL_TARGET_PER_SLOT = 0.015;

/**
 * Compute volatility-based size cap.
 * Asset annualized vol approximation: (ATR / price) * √252.
 * Optimal size fraction = target_vol / asset_vol.
 * High-vol names get smaller positions; low-vol names get larger.
 */
function volatilityBasedSizeCap(
  portfolioUsd: number,
  price: number,
  atr14: number | null
): number {
  if (!atr14 || atr14 <= 0 || price <= 0) return portfolioUsd * 0.5; // fallback to existing 50% cap
  const dailyVolPct = atr14 / price;
  const annualVolPct = dailyVolPct * Math.sqrt(252);
  if (annualVolPct <= 0) return portfolioUsd * 0.5;
  const fraction = Math.min(0.5, VOL_TARGET_PER_SLOT / annualVolPct);
  return portfolioUsd * fraction;
}

interface RiskOutput {
  approved: ApprovedOrder[];
  rejected: Array<{ ticker: string; action: string; rejection_reason: string }>;
}

function calcExpectedMove(price: number, iv30: number | null, holdDays: number): number | null {
  if (!iv30 || iv30 <= 0) return null;
  return price * (iv30 / 100) * Math.sqrt(holdDays / 365);
}

/** Expand SWAP proposals into a SELL + BUY pair */
function expandSwaps(
  proposals: OrderProposal[],
  positions: Position[]
): OrderProposal[] {
  const expanded: OrderProposal[] = [];

  for (const p of proposals) {
    if (p.action !== 'SWAP') {
      expanded.push(p);
      continue;
    }

    // Validate swap_sell_ticker exists
    if (!p.swap_sell_ticker) {
      console.log(`[Risk] SWAP ${p.ticker}: missing swap_sell_ticker, converting to BUY`);
      expanded.push({ ...p, action: 'BUY' });
      continue;
    }

    const existing = positions.find((pos) => pos.ticker === p.swap_sell_ticker);
    if (!existing) {
      console.log(`[Risk] SWAP ${p.ticker}: swap_sell_ticker ${p.swap_sell_ticker} not in positions, skipping`);
      continue;
    }

    // Conviction delta check
    const entryConviction = existing.entry_conviction ?? 0;
    const convictionDelta = p.confidence - entryConviction;
    if (convictionDelta < 20) {
      console.log(`[Risk] SWAP ${p.ticker}: conviction delta ${convictionDelta} < 20, skipping`);
      continue;
    }

    // days_held check
    const daysHeld = existing.days_held ?? 0;
    if (daysHeld < 2) {
      console.log(`[Risk] SWAP ${p.ticker}: ${p.swap_sell_ticker} only held ${daysHeld} days < 2, skipping`);
      continue;
    }

    // pnlPct check: not > +8%
    const pnlPct = existing.pnlPct ?? 0;
    if (pnlPct > 8) {
      console.log(`[Risk] SWAP ${p.ticker}: ${p.swap_sell_ticker} pnl ${pnlPct.toFixed(1)}% > 8%, skipping`);
      continue;
    }

    // Emit SELL then BUY
    const sellOrder: OrderProposal = {
      ticker: p.swap_sell_ticker,
      action: 'SELL',
      trade_type: p.trade_type,
      limit_price: existing.currentPrice,
      stop_loss: 0,
      take_profit: 0,
      invalidation_condition: `SWAP: replaced by ${p.ticker}`,
      size_pct: 100, // SELL full position; size_usd computed at execution from pos.sizeUsd
      confidence: p.confidence,
      debate_score: p.debate_score,
      bull_conviction: p.bull_conviction,
      bear_conviction: p.bear_conviction,
      reasoning: `SWAP: vente de ${p.swap_sell_ticker} pour financer ${p.ticker}`,
    };

    const buyOrder: OrderProposal = {
      ...p,
      action: 'BUY',
      swap_sell_ticker: undefined,
    };

    expanded.push(sellOrder, buyOrder);
    console.log(`[Risk] SWAP approved: SELL ${p.swap_sell_ticker} + BUY ${p.ticker}`);
  }

  return expanded;
}

export class RiskAgent {
  async run(
    proposals: OrderProposal[],
    portfolioUsd: number,
    portfolio: { cash_usd?: number; daily_pnl_pct: number; risk_regime: string; positions: Position[] },
    market: { vix: number; fear_greed: number; nasdaq_direction: string },
    dailyLossLimitPct: number,
    tickerData?: Record<string, TickerData>,
    rejections?: Array<{ ticker: string; action: string; reason: string }>,
  ): Promise<ApprovedOrder[]> {
    console.log(`[Risk] Validating ${proposals.length} proposals`);

    if (proposals.length === 0) return [];

    // Expand SWAP proposals into SELL + BUY pairs first
    const expandedProposals = expandSwaps(proposals, portfolio.positions);

    const preFiltered = this.deterministicPreFilter(
      expandedProposals,
      portfolioUsd,
      portfolio,
      market,
      dailyLossLimitPct,
      tickerData,
      rejections,
    );

    if (preFiltered.length === 0) return [];

    const deterministicApproved = this.deterministicValidation(
      preFiltered,
      portfolioUsd,
      portfolio,
      market.vix,
      dailyLossLimitPct,
      tickerData
    );

    if (deterministicApproved.length === 0) return [];

    const ambiguousOrders = deterministicApproved.filter(
      (o) => o.confidence < 70 || market.vix > 25
    );

    if (ambiguousOrders.length === 0) {
      console.log(`[Risk] All ${deterministicApproved.length} orders validated deterministically`);
      return this.enforceCashBudget(deterministicApproved, portfolioUsd, portfolio);
    }

    try {
      const MODELS = await getModels();
      const prompt = buildRiskPrompt({
        proposals: ambiguousOrders.map((o) => ({
          ticker: o.ticker,
          action: o.action,
          trade_type: o.trade_type,
          limit_price: o.limit_price,
          stop_loss: o.stop_loss,
          take_profit: o.take_profit,
          invalidation_condition: o.invalidation_condition,
          size_pct: o.size_usd / portfolioUsd * 100,
          confidence: o.confidence,
          debate_score: o.debate_score,
          bull_conviction: o.bull_conviction,
          bear_conviction: o.bear_conviction,
          reasoning: o.reasoning,
        })),
        portfolio_usd: portfolioUsd,
        daily_pnl_pct: portfolio.daily_pnl_pct,
        positions: portfolio.positions,
        market,
        daily_loss_limit_pct: dailyLossLimitPct,
      });

      const response = await callLLM('risk-manager', MODELS.STRONG, RISK_SYSTEM, prompt, { thinking: true });
      const parsed = parseJsonResponse<RiskOutput>(response.content);

      if (parsed.rejected && parsed.rejected.length > 0) {
        for (const r of parsed.rejected) {
          console.log(`[Risk] LLM rejected ${r.ticker} ${r.action}: ${r.rejection_reason}`);
        }
      }

      const llmApproved = parsed.approved || [];
      const nonAmbiguous = deterministicApproved.filter((o) => o.confidence >= 70 && market.vix <= 25);
      console.log(`[Risk] Final: ${nonAmbiguous.length} deterministic + ${llmApproved.length} LLM-validated`);
      return this.enforceCashBudget([...nonAmbiguous, ...llmApproved], portfolioUsd, portfolio);
    } catch (err) {
      console.warn('[Risk] LLM failed, using deterministic results:', (err as Error).message);
      return this.enforceCashBudget(deterministicApproved, portfolioUsd, portfolio);
    }
  }

  private deterministicPreFilter(
    proposals: OrderProposal[],
    portfolioUsd: number,
    portfolio: { cash_usd?: number; daily_pnl_pct: number; risk_regime: string; positions: { ticker: string; sizeUsd?: number }[] },
    market: { vix: number },
    dailyLossLimitPct: number,
    tickerData?: Record<string, TickerData>,
    rejections?: Array<{ ticker: string; action: string; reason: string }>,
  ): OrderProposal[] {
    const sectorCounts: Record<string, number> = {};
    for (const pos of portfolio.positions) {
      const sector = getTickerSector(pos.ticker);
      sectorCounts[sector] = (sectorCounts[sector] || 0) + 1;
    }

    const filtered: OrderProposal[] = [];

    // Macro blackout: skip new BUYs around FOMC / CPI / NFP days (vol noise)
    const macroEvent = isMacroBlackout();
    if (macroEvent) {
      console.log(`[Risk] Macro blackout active: ${macroEvent.kind} on ${macroEvent.date} — blocking new BUYs`);
    }

    const reject = (p: OrderProposal, reason: string) => {
      console.log(`[Risk] Pre-filter ${p.ticker}: ${reason}`);
      rejections?.push({ ticker: p.ticker, action: p.action, reason });
    };

    for (const p of proposals) {
      if (macroEvent && p.action === 'BUY') {
        reject(p, `macro blackout (${macroEvent.kind} ${macroEvent.date})`);
        continue;
      }

      if (portfolio.daily_pnl_pct <= -dailyLossLimitPct && p.action === 'BUY') {
        reject(p, `daily loss limit reached (${portfolio.daily_pnl_pct.toFixed(2)}%)`);
        continue;
      }

      if (portfolio.risk_regime === 'SEVERE_DRAWDOWN' && p.action === 'BUY') {
        reject(p, 'severe drawdown regime, no new buys');
        continue;
      }
      if (portfolio.risk_regime === 'DRAWDOWN' && p.action === 'BUY') {
        reject(p, 'drawdown regime, no new buys');
        continue;
      }

      if (market.vix > 30 && p.action === 'BUY') {
        reject(p, `VIX ${market.vix} > 30`);
        continue;
      }

      if (p.action === 'BUY' && p.confidence < MIN_BUY_CONFIDENCE) {
        reject(p, `confidence ${p.confidence}% < minimum ${MIN_BUY_CONFIDENCE}%`);
        continue;
      }

      if (p.action === 'BUY') {
        const rr = (p.take_profit - p.limit_price) / (p.limit_price - p.stop_loss);
        if (rr < 2.0) {
          reject(p, `R/R ${rr.toFixed(2)} < 2.0`);
          continue;
        }
      }

      if (tickerData?.[p.ticker]?.earnings_blackout) {
        reject(p, 'earnings blackout');
        continue;
      }

      if (p.action === 'BUY') {
        const sector = getTickerSector(p.ticker);
        const currentCount = sectorCounts[sector] || 0;
        if (currentCount >= MAX_POSITIONS_PER_SECTOR) {
          reject(p, `sector ${sector} concentration max (${currentCount}/${MAX_POSITIONS_PER_SECTOR})`);
          continue;
        }
        sectorCounts[sector] = currentCount + 1;
      }

      filtered.push(p);
    }

    return filtered;
  }

  private deterministicValidation(
    proposals: OrderProposal[],
    portfolioUsd: number,
    portfolio: { cash_usd?: number; daily_pnl_pct: number; risk_regime: string; positions: { ticker: string; sizeUsd?: number }[] },
    vix: number,
    dailyLossLimitPct: number,
    tickerData?: Record<string, TickerData>
  ): ApprovedOrder[] {
    const approved: ApprovedOrder[] = [];

    let sizingMultiplier = 1.0;
    if (portfolio.risk_regime === 'ELEVATED') sizingMultiplier = 0.75;
    if (portfolio.risk_regime === 'CRISIS') sizingMultiplier = 0.5;
    if (portfolio.risk_regime === 'DRAWDOWN') sizingMultiplier = 0.5;
    if (portfolio.risk_regime === 'SEVERE_DRAWDOWN') sizingMultiplier = 0.25;

    if (vix > 25) sizingMultiplier *= 0.75;
    if (vix > 30) sizingMultiplier *= 0.5;

    const sectorExposure: Record<string, number> = {};
    for (const pos of portfolio.positions) {
      const sector = getTickerSector(pos.ticker);
      sectorExposure[sector] = (sectorExposure[sector] || 0) + (pos.sizeUsd || 0);
    }

    for (const p of proposals) {
      // SELL orders pass through directly
      if (p.action === 'SELL') {
        approved.push({
          ticker: p.ticker,
          action: p.action,
          trade_type: p.trade_type,
          limit_price: p.limit_price,
          stop_loss: p.stop_loss,
          take_profit: p.take_profit,
          invalidation_condition: p.invalidation_condition,
          size_usd: 0, // computed at execution time for SELL
          confidence: p.confidence,
          debate_score: p.debate_score,
          bull_conviction: p.bull_conviction,
          bear_conviction: p.bear_conviction,
          reasoning: p.reasoning,
        });
        continue;
      }

      let sizeUsd = portfolioUsd * (p.size_pct / 100) * sizingMultiplier;

      const td = tickerData?.[p.ticker];
      const opts = td?.options as { iv30?: number | null } | undefined;
      const iv30 = opts?.iv30 ?? null;
      const holdDays = 10;
      const expectedMove = calcExpectedMove(p.limit_price, iv30, holdDays);
      const targetDistance = Math.abs(p.take_profit - p.limit_price);

      if (expectedMove !== null && expectedMove > targetDistance) {
        const reductionFactor = Math.min(0.7, targetDistance / expectedMove);
        console.log(`[Risk] ${p.ticker}: Expected move $${expectedMove.toFixed(2)} > target $${targetDistance.toFixed(2)} — reducing size by ${((1 - reductionFactor) * 100).toFixed(0)}%`);
        sizeUsd *= reductionFactor;
      }

      // Volatility targeting: cap size based on asset's annualized vol.
      // High-vol names get capped harder than low-vol names → equalizes risk per slot.
      const indicatorAtr = (td?.indicators as any)?.atr_14 ?? null;
      const volCap = volatilityBasedSizeCap(portfolioUsd, p.limit_price, indicatorAtr);
      if (volCap < sizeUsd) {
        console.log(`[Risk] ${p.ticker}: vol cap reducing size $${sizeUsd.toFixed(0)} → $${volCap.toFixed(0)} (ATR=${indicatorAtr ?? 'N/A'})`);
        sizeUsd = volCap;
      }
      sizeUsd = Math.min(sizeUsd, portfolioUsd * 0.50);

      if (p.action === 'BUY') {
        const sector = getTickerSector(p.ticker);
        const currentExposure = sectorExposure[sector] || 0;
        const maxSectorUsd = portfolioUsd * MAX_SECTOR_NAV_PCT;
        if (currentExposure + sizeUsd > maxSectorUsd) {
          const adjustedSize = maxSectorUsd - currentExposure;
          if (adjustedSize > 0) {
            console.log(`[Risk] ${p.ticker}: sector ${sector} at ${(currentExposure / portfolioUsd * 100).toFixed(1)}% NAV, reducing from $${sizeUsd.toFixed(0)} to $${adjustedSize.toFixed(0)}`);
            sizeUsd = adjustedSize;
          } else {
            console.log(`[Risk] ${p.ticker}: sector ${sector} at ${(currentExposure / portfolioUsd * 100).toFixed(1)}% NAV cap, skipping`);
            continue;
          }
        }
        sectorExposure[sector] = (sectorExposure[sector] || 0) + sizeUsd;
      }

      // After expandSwaps, action can only be BUY or SELL at this point
      const approvedAction = p.action as 'BUY' | 'SELL';
      approved.push({
        ticker: p.ticker,
        action: approvedAction,
        trade_type: p.trade_type,
        limit_price: p.limit_price,
        stop_loss: p.stop_loss,
        take_profit: p.take_profit,
        invalidation_condition: p.invalidation_condition,
        size_usd: sizeUsd,
        confidence: p.confidence,
        debate_score: p.debate_score,
        bull_conviction: p.bull_conviction,
        bear_conviction: p.bear_conviction,
        reasoning: p.reasoning,
      });
    }

    return approved;
  }

  private enforceCashBudget(
    orders: ApprovedOrder[],
    portfolioUsd: number,
    portfolio: { cash_usd?: number; positions: { sizeUsd?: number }[] }
  ): ApprovedOrder[] {
    let remainingCash = portfolio.cash_usd;

    if (remainingCash === undefined) {
      const investedUsd = portfolio.positions.reduce((sum, p) => sum + (p.sizeUsd || 0), 0);
      remainingCash = Math.max(0, portfolioUsd - investedUsd);
    }

    const budgeted: ApprovedOrder[] = [];

    for (const order of orders) {
      if (order.action !== 'BUY') {
        // SELL orders: add freed cash back to pool
        const pos = portfolio.positions.find((p) => (p as any).ticker === order.ticker);
        if (pos?.sizeUsd) {
          remainingCash += pos.sizeUsd;
        }
        budgeted.push(order);
        continue;
      }

      const sizeUsd = Math.min(order.size_usd, Math.max(0, remainingCash));
      if (sizeUsd < 1) {
        console.log(`[Risk] ${order.ticker}: rejected, no cash left (requested $${order.size_usd.toFixed(0)})`);
        continue;
      }

      if (sizeUsd < order.size_usd) {
        console.log(`[Risk] ${order.ticker}: cash cap, reducing from $${order.size_usd.toFixed(0)} to $${sizeUsd.toFixed(0)}`);
      }

      budgeted.push({ ...order, size_usd: sizeUsd });
      remainingCash -= sizeUsd;
    }

    return budgeted;
  }

  private async getKellyFractionSync(tradeType: string): Promise<number> {
    try {
      const closedTrades = await prisma.trade.findMany({
        where: { closedAt: { not: null }, pnlUsd: { not: null }, tradeType: tradeType },
        select: { pnlUsd: true },
      });

      if (closedTrades.length < 10) return 0.4;

      const wins = closedTrades.filter((t) => (t.pnlUsd ?? 0) > 0);
      const winRate = wins.length / closedTrades.length;

      const avgWin = wins.reduce((s, t) => s + (t.pnlUsd ?? 0), 0) / Math.max(wins.length, 1);
      const losses = closedTrades.filter((t) => (t.pnlUsd ?? 0) <= 0);
      const avgLoss = Math.abs(losses.reduce((s, t) => s + (t.pnlUsd ?? 0), 0)) / Math.max(losses.length, 1);

      if (avgLoss === 0) return 0.4;

      const profitLossRatio = avgWin / avgLoss;
      const kelly = (profitLossRatio * winRate - (1 - winRate)) / profitLossRatio;
      const halfKelly = Math.max(0.1, Math.min(kelly * 0.5, 0.4));

      console.log(`[Risk] Kelly fraction for type ${tradeType}: winRate=${winRate.toFixed(2)}, P/L ratio=${profitLossRatio.toFixed(2)}, halfKelly=${halfKelly.toFixed(3)}`);
      return halfKelly;
    } catch {
      return 0.4;
    }
  }

  private getKellyFraction(tradeType: string): number {
    const defaults: Record<string, number> = { A: 0.35, B: 0.25, C: 0.2 };
    return defaults[tradeType] || 0.3;
  }
}
