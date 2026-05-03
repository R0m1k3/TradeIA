import { callLLM, parseJsonResponse } from '../llm/client';
import { getModels } from '../llm/models';
import { buildRiskPrompt, RISK_SYSTEM } from '../prompts/risk.prompt';
import type { OrderProposal } from './strategist';
import type { ApprovedOrder } from '../broker/mock';
import type { TickerData } from './collector';
import { getTickerSector, countPositionsBySector } from '../data/sectors';
import { prisma } from '../lib/prisma';

const MAX_POSITIONS_PER_SECTOR = 3;
const MAX_SECTOR_NAV_PCT = 0.40; // max 40% of NAV in a single sector

interface RiskOutput {
  approved: ApprovedOrder[];
  rejected: Array<{ ticker: string; action: string; rejection_reason: string }>;
}

/** Calcule l'Expected Move sur holdDays jours depuis l'IV30 */
function calcExpectedMove(price: number, iv30: number | null, holdDays: number): number | null {
  if (!iv30 || iv30 <= 0) return null;
  return price * (iv30 / 100) * Math.sqrt(holdDays / 365);
}

export class RiskAgent {
  async run(
    proposals: OrderProposal[],
    portfolioUsd: number,
    portfolio: { daily_pnl_pct: number; risk_regime: string; positions: { ticker: string; sizeUsd?: number }[] },
    market: { vix: number; fear_greed: number; nasdaq_direction: string },
    dailyLossLimitPct: number,
    tickerData?: Record<string, TickerData>
  ): Promise<ApprovedOrder[]> {
    console.log(`[Risk] Validating ${proposals.length} proposals`);

    if (proposals.length === 0) return [];

    // Pre-filter déterministe — always runs first
    const preFiltered = this.deterministicPreFilter(
      proposals,
      portfolioUsd,
      portfolio,
      market,
      dailyLossLimitPct,
      tickerData
    );

    if (preFiltered.length === 0) return [];

    // Deterministic validation is the primary path — fast, cheap, consistent
    const deterministicApproved = this.deterministicValidation(
      preFiltered,
      portfolioUsd,
      portfolio,
      market.vix,
      dailyLossLimitPct,
      tickerData
    );

    if (deterministicApproved.length === 0) return [];

    // LLM validation only if models available and we have ambiguous cases
    // (low conviction, conflicting signals, or VIX regime edge cases)
    const ambiguousOrders = deterministicApproved.filter(
      (o) => o.confidence < 70 || market.vix > 25
    );

    if (ambiguousOrders.length === 0) {
      console.log(`[Risk] All ${deterministicApproved.length} orders validated deterministically`);
      return deterministicApproved;
    }

    // Try LLM for ambiguous orders only
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
          risk_pct: o.size_usd / portfolioUsd * 100,
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

      const response = await callLLM('risk-manager', MODELS.STRONG, RISK_SYSTEM, prompt);
      const parsed = parseJsonResponse<RiskOutput>(response.content);

      if (parsed.rejected && parsed.rejected.length > 0) {
        for (const r of parsed.rejected) {
          console.log(`[Risk] LLM rejected ${r.ticker} ${r.action}: ${r.rejection_reason}`);
        }
      }

      const llmApproved = parsed.approved || [];
      // Combine: non-ambiguous from deterministic + LLM-filtered ambiguous
      const nonAmbiguous = deterministicApproved.filter((o) => o.confidence >= 70 && market.vix <= 25);
      console.log(`[Risk] Final: ${nonAmbiguous.length} deterministic + ${llmApproved.length} LLM-validated`);
      return [...nonAmbiguous, ...llmApproved];
    } catch (err) {
      console.warn('[Risk] LLM failed, using deterministic results:', (err as Error).message);
      return deterministicApproved;
    }
  }

  private deterministicPreFilter(
    proposals: OrderProposal[],
    portfolioUsd: number,
    portfolio: { daily_pnl_pct: number; risk_regime: string; positions: { ticker: string; sizeUsd?: number }[] },
    market: { vix: number },
    dailyLossLimitPct: number,
    tickerData?: Record<string, TickerData>
  ): OrderProposal[] {
    const sectorCounts = countPositionsBySector(portfolio.positions);
    const filtered: OrderProposal[] = [];

    for (const p of proposals) {
      // Blocage perte journalière (unrealized inclus)
      if (portfolio.daily_pnl_pct <= -dailyLossLimitPct && p.action === 'BUY') {
        console.log(`[Risk] Pre-filter ${p.ticker}: daily loss limit reached (${portfolio.daily_pnl_pct.toFixed(2)}%)`);
        continue;
      }

      // Drawdown regime — reduce or block based on severity
      if (portfolio.risk_regime === 'SEVERE_DRAWDOWN' && p.action === 'BUY') {
        console.log(`[Risk] Pre-filter ${p.ticker}: severe drawdown regime, no new buys`);
        continue;
      }
      if (portfolio.risk_regime === 'DRAWDOWN' && p.action === 'BUY') {
        console.log(`[Risk] Pre-filter ${p.ticker}: drawdown regime, no new buys`);
        continue;
      }

      // VIX trop élevé
      if (market.vix > 30 && p.action === 'BUY') {
        console.log(`[Risk] Pre-filter ${p.ticker}: VIX ${market.vix} > 30`);
        continue;
      }

      // R/R minimum
      const rr = p.action === 'BUY'
        ? (p.take_profit - p.limit_price) / (p.limit_price - p.stop_loss)
        : (p.limit_price - p.take_profit) / (p.stop_loss - p.limit_price);
      if (rr < 2.0) {
        console.log(`[Risk] Pre-filter ${p.ticker}: R/R ${rr.toFixed(2)} < 2.0`);
        continue;
      }

      // Earnings blackout
      if (tickerData?.[p.ticker]?.earnings_blackout) {
        console.log(`[Risk] Pre-filter ${p.ticker}: earnings blackout`);
        continue;
      }

      // Concentration sectorielle max
      if (p.action === 'BUY') {
        const sector = getTickerSector(p.ticker);
        const currentCount = sectorCounts[sector] || 0;
        if (currentCount >= MAX_POSITIONS_PER_SECTOR) {
          console.log(`[Risk] Pre-filter ${p.ticker}: sector ${sector} concentration max (${currentCount}/${MAX_POSITIONS_PER_SECTOR})`);
          continue;
        }
        // Incrémenter provisoirement pour éviter plusieurs approbations sur le même secteur
        sectorCounts[sector] = currentCount + 1;
      }

      filtered.push(p);
    }

    return filtered;
  }

  private deterministicValidation(
    proposals: OrderProposal[],
    portfolioUsd: number,
    portfolio: { daily_pnl_pct: number; risk_regime: string; positions: { ticker: string; sizeUsd?: number }[] },
    vix: number,
    dailyLossLimitPct: number,
    tickerData?: Record<string, TickerData>
  ): ApprovedOrder[] {
    const approved: ApprovedOrder[] = [];

    // Drawdown regime sizing reduction (progressive)
    let sizingMultiplier = 1.0;
    if (portfolio.risk_regime === 'ELEVATED') sizingMultiplier = 0.75;
    if (portfolio.risk_regime === 'CRISIS') sizingMultiplier = 0.5;
    if (portfolio.risk_regime === 'DRAWDOWN') sizingMultiplier = 0.5;
    if (portfolio.risk_regime === 'SEVERE_DRAWDOWN') sizingMultiplier = 0.25;

    // VIX regime sizing reduction
    if (vix > 25) sizingMultiplier *= 0.75;
    if (vix > 30) sizingMultiplier *= 0.5;

    // Calculate sector exposure for concentration check
    const sectorExposure: Record<string, number> = {};
    for (const pos of portfolio.positions) {
      const sector = getTickerSector(pos.ticker);
      sectorExposure[sector] = (sectorExposure[sector] || 0) + pos.sizeUsd;
    }

    for (const p of proposals) {
      // Kelly-based sizing: fraction = (bp - (1-b)/p_w) where b=win_rate, p=profit/loss ratio
      // Simplified: use half-Kelly for safety
      const kellyFraction = this.getKellyFraction(p.trade_type);

      // ATR-based sizing: risk_amount / (ATR_distance * multiplier)
      // Stop loss distance = entry - stop_loss for BUY
      const stopDistance = Math.abs(p.limit_price - p.stop_loss);
      const atrSizing = stopDistance > 0
        ? (portfolioUsd * (p.risk_pct / 100) * 0.02) / stopDistance // risk 2% of portfolio per trade
        : portfolioUsd * 0.02; // fallback

      // Base sizing = min(Kelly sizing, ATR sizing) * confidence * regime multiplier
      const kellySize = portfolioUsd * kellyFraction * (p.confidence / 100);
      let sizeUsd = Math.min(kellySize, atrSizing) * sizingMultiplier;

      // Réduction si IV30 Expected Move dépasse l'objectif
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

      // Max 5% of portfolio per position
      sizeUsd = Math.min(sizeUsd, portfolioUsd * 0.05);

      // Sector concentration check: max 40% of NAV in one sector
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

      approved.push({
        ticker: p.ticker,
        action: p.action,
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

  /** Get Kelly fraction based on historical win rate by trade type */
  private async getKellyFractionSync(tradeType: string): Promise<number> {
    try {
      const closedTrades = await prisma.trade.findMany({
        where: { closedAt: { not: null }, pnlUsd: { not: null }, tradeType: tradeType },
        select: { pnlUsd: true },
      });

      if (closedTrades.length < 10) return 0.4; // default half-Kelly equivalent

      const wins = closedTrades.filter((t) => (t.pnlUsd ?? 0) > 0);
      const winRate = wins.length / closedTrades.length;

      // Average win / average loss for profit factor
      const avgWin = wins.reduce((s, t) => s + (t.pnlUsd ?? 0), 0) / Math.max(wins.length, 1);
      const losses = closedTrades.filter((t) => (t.pnlUsd ?? 0) <= 0);
      const avgLoss = Math.abs(losses.reduce((s, t) => s + (t.pnlUsd ?? 0), 0)) / Math.max(losses.length, 1);

      if (avgLoss === 0) return 0.4;

      const profitLossRatio = avgWin / avgLoss;
      // Kelly formula: f = (bp - q) / b where b=profit/loss ratio, p=win rate, q=1-p
      const kelly = (profitLossRatio * winRate - (1 - winRate)) / profitLossRatio;
      // Use half-Kelly for safety
      const halfKelly = Math.max(0.1, Math.min(kelly * 0.5, 0.4));

      console.log(`[Risk] Kelly fraction for type ${tradeType}: winRate=${winRate.toFixed(2)}, P/L ratio=${profitLossRatio.toFixed(2)}, halfKelly=${halfKelly.toFixed(3)}`);
      return halfKelly;
    } catch {
      return 0.4;
    }
  }

  /** Synchronous Kelly fraction fallback using cached stats */
  private getKellyFraction(tradeType: string): number {
    // Will be overridden by async version when available
    // This is a conservative default
    const defaults: Record<string, number> = { A: 0.35, B: 0.25, C: 0.2 };
    return defaults[tradeType] || 0.3;
  }
}
