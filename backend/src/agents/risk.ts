import { callLLM, parseJsonResponse } from '../llm/client';
import { getModels } from '../llm/models';
import { buildRiskPrompt, RISK_SYSTEM } from '../prompts/risk.prompt';
import type { OrderProposal } from './strategist';
import type { ApprovedOrder } from '../broker/mock';
import type { TickerData } from './collector';
import { getTickerSector, countPositionsBySector } from '../data/sectors';

const MAX_POSITIONS_PER_SECTOR = 3;

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
    portfolio: { daily_pnl_pct: number; positions: { ticker: string }[] },
    market: { vix: number; fear_greed: number; nasdaq_direction: string },
    dailyLossLimitPct: number,
    tickerData?: Record<string, TickerData>
  ): Promise<ApprovedOrder[]> {
    console.log(`[Risk] Validating ${proposals.length} proposals`);
    const MODELS = await getModels();

    if (proposals.length === 0) return [];

    // Pre-filter déterministe avant LLM
    const preFiltered = this.deterministicPreFilter(
      proposals,
      portfolioUsd,
      portfolio,
      market,
      dailyLossLimitPct,
      tickerData
    );

    if (preFiltered.length === 0) return [];

    try {
      const prompt = buildRiskPrompt({
        proposals: preFiltered,
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

      const approved = parsed.approved || [];
      console.log(`[Risk] Approved ${approved.length}/${proposals.length} orders`);
      return approved;
    } catch (err) {
      console.error('[Risk] Error — falling back to deterministic validation:', err);
      return this.deterministicValidation(
        preFiltered,
        portfolioUsd,
        portfolio.daily_pnl_pct,
        market.vix,
        dailyLossLimitPct,
        tickerData
      );
    }
  }

  private deterministicPreFilter(
    proposals: OrderProposal[],
    portfolioUsd: number,
    portfolio: { daily_pnl_pct: number; positions: { ticker: string }[] },
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
    dailyPnlPct: number,
    vix: number,
    dailyLossLimitPct: number,
    tickerData?: Record<string, TickerData>
  ): ApprovedOrder[] {
    const approved: ApprovedOrder[] = [];

    for (const p of proposals) {
      // Calcul sizing de base
      let sizeUsd = portfolioUsd * (p.risk_pct / 100) * (p.confidence / 100) * 0.4;

      // Réduction si IV30 Expected Move dépasse l'objectif
      const td = tickerData?.[p.ticker];
      const opts = td?.options as { iv30?: number | null } | undefined;
      const iv30 = opts?.iv30 ?? null;
      const holdDays = 10; // swing par défaut
      const expectedMove = calcExpectedMove(p.limit_price, iv30, holdDays);
      const targetDistance = Math.abs(p.take_profit - p.limit_price);

      if (expectedMove !== null && expectedMove > targetDistance) {
        const reductionFactor = Math.min(0.7, targetDistance / expectedMove);
        console.log(`[Risk] ${p.ticker}: Expected move $${expectedMove.toFixed(2)} > target $${targetDistance.toFixed(2)} — reducing size by ${((1 - reductionFactor) * 100).toFixed(0)}%`);
        sizeUsd *= reductionFactor;
      }

      sizeUsd = Math.min(sizeUsd, portfolioUsd * 0.05);

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
}
