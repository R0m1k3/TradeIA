import { callLLM, parseJsonResponse } from '../llm/client';
import { getModels } from '../llm/models';
import { buildRiskPrompt, RISK_SYSTEM } from '../prompts/risk.prompt';
import type { OrderProposal } from './strategist';
import type { ApprovedOrder } from '../broker/mock';

interface RiskOutput {
  approved: ApprovedOrder[];
  rejected: Array<{ ticker: string; action: string; rejection_reason: string }>;
}

export class RiskAgent {
  async run(
    proposals: OrderProposal[],
    portfolioUsd: number,
    portfolio: { daily_pnl_pct: number; positions: unknown[] },
    market: { vix: number; fear_greed: number; nasdaq_direction: string },
    dailyLossLimitPct: number
  ): Promise<ApprovedOrder[]> {
    console.log(`[Risk] Validating ${proposals.length} proposals`);
    const MODELS = await getModels();

    if (proposals.length === 0) return [];

    try {
      const prompt = buildRiskPrompt({
        proposals,
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
          console.log(`[Risk] Rejected ${r.ticker} ${r.action}: ${r.rejection_reason}`);
        }
      }

      const approved = parsed.approved || [];
      console.log(`[Risk] Approved ${approved.length}/${proposals.length} orders`);
      return approved;
    } catch (err) {
      console.error('[Risk] Error — falling back to deterministic validation:', err);
      return this.deterministicValidation(proposals, portfolioUsd, portfolio.daily_pnl_pct, market.vix, dailyLossLimitPct);
    }
  }

  private deterministicValidation(
    proposals: OrderProposal[],
    portfolioUsd: number,
    dailyPnlPct: number,
    vix: number,
    dailyLossLimitPct: number
  ): ApprovedOrder[] {
    const approved: ApprovedOrder[] = [];

    for (const p of proposals) {
      if (dailyPnlPct <= -dailyLossLimitPct && p.action === 'BUY') {
        console.log(`[Risk] Blocked ${p.ticker}: daily loss limit reached`);
        continue;
      }

      const rr = (p.take_profit - p.limit_price) / (p.limit_price - p.stop_loss);
      if (rr < 1.5) {
        console.log(`[Risk] Rejected ${p.ticker}: R/R ${rr.toFixed(2)} < 1.5`);
        continue;
      }

      if (vix > 30 && p.action === 'BUY') {
        console.log(`[Risk] Blocked ${p.ticker}: VIX ${vix} > 30`);
        continue;
      }

      let sizeUsd = portfolioUsd * (p.risk_pct / 100) * (p.confidence / 100) * 0.5;
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
