import type { OrderProposal } from './strategist';
import type { Position } from '../broker/mock';
import type { DebateOutput } from './researcher';
import type { AllocationBudget } from './balance-controller';
import type { RegimeAssessment } from './regime';
import type { SectorBias } from '../data/sectors';
import { getTickerSector } from '../data/sectors';

// ── Portfolio Heat ──────────────────────────────────────────
export interface PortfolioHeat {
  current_heat_pct: number;
  max_heat_pct: number;
  available_heat_pct: number;
  position_risks: Array<{
    ticker: string;
    risk_usd: number;
    risk_pct: number;
  }>;
  must_release: boolean;
}

const MAX_PORTFOLIO_HEAT_PCT = 8; // 8% max aggregate risk

export function computePortfolioHeat(
  positions: Position[],
  portfolioUsd: number,
): PortfolioHeat {
  const positionRisks = positions.map((p) => {
    const riskPct = p.entryPrice > 0 && p.stopLoss > 0
      ? ((p.entryPrice - p.stopLoss) / p.entryPrice) * (p.sizeUsd / portfolioUsd) * 100
      : (p.sizeUsd / portfolioUsd) * 2; // fallback: assume 2% risk if no stop
    const riskUsd = portfolioUsd * (riskPct / 100);
    return { ticker: p.ticker, risk_usd: riskUsd, risk_pct: riskPct };
  });

  const currentHeatPct = positionRisks.reduce((s, r) => s + r.risk_pct, 0);
  const availableHeatPct = Math.max(0, MAX_PORTFOLIO_HEAT_PCT - currentHeatPct);

  return {
    current_heat_pct: Math.round(currentHeatPct * 100) / 100,
    max_heat_pct: MAX_PORTFOLIO_HEAT_PCT,
    available_heat_pct: Math.round(availableHeatPct * 100) / 100,
    position_risks: positionRisks,
    must_release: currentHeatPct > MAX_PORTFOLIO_HEAT_PCT,
  };
}

// ── Opportunity Cost ────────────────────────────────────────
export interface HoldAssessment {
  ticker: string;
  hold_score: number;         // debate_score for held position (negative = bear dominating)
  pnl_pct: number;
  days_held: number;
  trade_type: string;
  sector: string;
  opportunity_cost: number;   // best_available_signal - hold_score
  release_reason: string | null;
  release_priority: number;   // higher = more urgent to release
}

const OPPORTUNITY_COST_THRESHOLD = 30; // signal must be 30+ points better
const MAX_HOLD_DAYS: Record<string, number> = { A: 15, B: 10, C: 8 };

export function assessHoldOpportunity(
  positions: Position[],
  debates: DebateOutput[],
  sectorBiases: Record<string, SectorBias>,
): HoldAssessment[] {
  const debateMap = new Map(debates.map((d) => [d.ticker, d]));

  // Best signal score among non-held tickers
  const nonHeldDebates = debates.filter(
    (d) => !positions.some((p) => p.ticker === d.ticker),
  );
  const bestSignalScore = nonHeldDebates.length > 0
    ? Math.max(...nonHeldDebates.map((d) => d.analyst_output.confidence + d.debate_score * 5))
    : 0;

  return positions.map((pos) => {
    const debate = debateMap.get(pos.ticker);
    const holdScore = debate?.debate_score ?? 0;
    const pnlPct = pos.pnlPct ?? 0;
    const daysHeld = pos.days_held ?? 0;
    const sector = getTickerSector(pos.ticker);
    const sectorBias = sectorBiases[sector];

    // Infer trade type from debate, default B
    const tradeType = debate?.analyst_output?.trade_type ?? 'B';
    const maxHold = MAX_HOLD_DAYS[tradeType] ?? 10;

    const opportunityCost = bestSignalScore - (holdScore * 5 + (debate?.analyst_output?.confidence ?? 50));

    let releaseReason: string | null = null;
    let releasePriority = 0;

    // Rule 1: Thesis invalidated — bear dominates
    if (holdScore <= -2) {
      releaseReason = `Thèse invalidée: debate_score ${holdScore} ≤ -2`;
      releasePriority = 50 - holdScore; // lower score = higher priority
    }

    // Rule 2: Flat position past 70% of max hold time
    if (!releaseReason && Math.abs(pnlPct) < 1 && daysHeld >= maxHold * 0.7) {
      releaseReason = `Position plate (${pnlPct.toFixed(1)}%) après ${daysHeld.toFixed(0)}j ≥ 70% de ${maxHold}j max`;
      releasePriority = 20;
    }

    // Rule 3: Sector bias reversed + losing
    if (!releaseReason && sectorBias && sectorBias.direction === 'bearish' && pnlPct < 0) {
      releaseReason = `Secteur ${sector} bearish (${sectorBias.change_pct?.toFixed(1)}%) + position perdante (${pnlPct.toFixed(1)}%)`;
      releasePriority = 30;
    }

    // Rule 4: Significant opportunity cost (only if other conditions also met)
    if (!releaseReason && opportunityCost > OPPORTUNITY_COST_THRESHOLD) {
      // Only release for opportunity cost if position is also underperforming
      if (pnlPct < -3 && daysHeld >= 3) {
        releaseReason = `Coût d'opportunité élevé (${opportunityCost.toFixed(0)} pts) + position perdante (${pnlPct.toFixed(1)}%, ${daysHeld.toFixed(0)}j)`;
        releasePriority = 15;
      }
    }

    return {
      ticker: pos.ticker,
      hold_score: holdScore,
      pnl_pct: pnlPct,
      days_held: daysHeld,
      trade_type: tradeType,
      sector,
      opportunity_cost: Math.round(opportunityCost),
      release_reason: releaseReason,
      release_priority: releasePriority,
    };
  });
}

// ── Thesis Invalidation Exit ────────────────────────────────
export function generateThesisInvalidationExits(
  positions: Position[],
  debates: DebateOutput[],
  sectorBiases: Record<string, SectorBias>,
): OrderProposal[] {
  const assessments = assessHoldOpportunity(positions, debates, sectorBiases);
  const exits: OrderProposal[] = [];

  for (const a of assessments) {
    if (a.release_reason) {
      const pos = positions.find((p) => p.ticker === a.ticker)!;
      exits.push({
        ticker: a.ticker,
        action: 'SELL',
        trade_type: a.trade_type as 'A' | 'B' | 'C',
        limit_price: pos.currentPrice,
        stop_loss: 0,
        take_profit: 0,
        invalidation_condition: a.release_reason,
        size_pct: 100,
        confidence: 70 + Math.min(20, a.release_priority),
        debate_score: a.hold_score,
        bull_conviction: 1,
        bear_conviction: 8,
        reasoning: a.release_reason,
      });
    }
  }

  return exits;
}

// ── Portfolio Allocator ─────────────────────────────────────
export interface AllocationResult {
  approved_proposals: OrderProposal[];
  sell_recommendations: OrderProposal[];
  portfolio_heat: PortfolioHeat;
  hold_assessments: HoldAssessment[];
  allocation_log: string[];
}

export class PortfolioAllocator {
  allocate(
    proposals: OrderProposal[],
    positions: Position[],
    debates: DebateOutput[],
    budget: AllocationBudget,
    portfolioUsd: number,
    sectorBiases: Record<string, SectorBias>,
    regime?: RegimeAssessment,
  ): AllocationResult {
    const log: string[] = [];
    const heat = computePortfolioHeat(positions, portfolioUsd);
    const assessments = assessHoldOpportunity(positions, debates, sectorBiases);

    log.push(`Portfolio heat: ${heat.current_heat_pct.toFixed(1)}%/${heat.max_heat_pct}% — available ${heat.available_heat_pct.toFixed(1)}%`);

    // Step 1: Generate thesis invalidation exits
    const thesisExits = generateThesisInvalidationExits(positions, debates, sectorBiases);
    if (thesisExits.length > 0) {
      log.push(`Thesis invalidation: ${thesisExits.length} exit(s) — ${thesisExits.map((e) => e.ticker).join(', ')}`);
    }

    // Step 2: If heat > max, force priority exits from weakest positions
    let forcedExits: OrderProposal[] = [];
    if (heat.must_release) {
      const weakPositions = assessments
        .filter((a) => a.release_priority > 0 || a.hold_score < 0)
        .sort((a, b) => b.release_priority - a.release_priority);

      const excessHeat = heat.current_heat_pct - heat.max_heat_pct;
      let releasedHeat = 0;

      for (const weak of weakPositions) {
        if (releasedHeat >= excessHeat) break;
        const pos = positions.find((p) => p.ticker === weak.ticker)!;
        const riskReleased = pos.entryPrice > 0 && pos.stopLoss > 0
          ? ((pos.entryPrice - pos.stopLoss) / pos.entryPrice) * (pos.sizeUsd / portfolioUsd) * 100
          : (pos.sizeUsd / portfolioUsd) * 2;

        // Don't force-exit profitable positions with strong hold scores
        if (weak.hold_score >= 2 && weak.pnl_pct > 2) {
          log.push(`Skip forced exit ${weak.ticker}: positive thesis (score ${weak.hold_score}) + profitable (${weak.pnl_pct.toFixed(1)}%)`);
          continue;
        }

        forcedExits.push({
          ticker: weak.ticker,
          action: 'SELL',
          trade_type: weak.trade_type as 'A' | 'B' | 'C',
          limit_price: pos.currentPrice,
          stop_loss: 0,
          take_profit: 0,
          invalidation_condition: `Forced exit: portfolio heat ${heat.current_heat_pct.toFixed(1)}% > ${heat.max_heat_pct}%`,
          size_pct: 100,
          confidence: 65,
          debate_score: weak.hold_score,
          bull_conviction: 1,
          bear_conviction: 7,
          reasoning: `Sortie forcée: heat portfolio ${heat.current_heat_pct.toFixed(1)}% > cap ${heat.max_heat_pct}%, position ${weak.ticker} score=${weak.hold_score} pnl=${weak.pnl_pct.toFixed(1)}%`,
        });
        releasedHeat += riskReleased;
      }

      if (forcedExits.length > 0) {
        log.push(`Heat overflow: forcing ${forcedExits.length} exit(s) releasing ${releasedHeat.toFixed(1)}% heat`);
      }
    }

    // Step 3: Rank BUY proposals by EV/risk
    const rankedBuys = [...proposals]
      .filter((p) => p.action === 'BUY')
      .map((p) => {
        // EV = confidence × (take_profit - limit_price) / limit_price, adjusted for debate_score
        const expectedMove = p.limit_price > 0
          ? (p.take_profit - p.limit_price) / p.limit_price
          : 0;
        const riskPerDollar = p.limit_price > 0 && p.limit_price !== p.stop_loss
          ? (p.limit_price - p.stop_loss) / p.limit_price
          : 0.03; // fallback 3% risk
        const ev = (p.confidence / 100) * expectedMove;
        const evPerRisk = riskPerDollar > 0 ? ev / riskPerDollar : 0;
        return { proposal: p, ev, riskPerDollar, evPerRisk };
      })
      .sort((a, b) => b.evPerRisk - a.evPerRisk);

    // Step 4: Allocate within heat budget
    let availableHeat = heat.available_heat_pct;
    const approvedBuys: OrderProposal[] = [];

    // Add freed heat from exits (thesis + forced)
    const allExits = [...thesisExits, ...forcedExits];
    const exitTickers = new Set(allExits.map((e) => e.ticker));
    for (const risk of heat.position_risks) {
      if (exitTickers.has(risk.ticker)) {
        availableHeat += risk.risk_pct;
      }
    }
    if (allExits.length > 0) {
      log.push(`Heat freed by exits: ${heat.position_risks.filter((r) => exitTickers.has(r.ticker)).reduce((s, r) => s + r.risk_pct, 0).toFixed(1)}%`);
    }

    // Regime adjustment: reduce allocation in bearish regimes
    const regimeMultiplier = regime?.sizing_multiplier ?? 1.0;

    for (const { proposal, riskPerDollar, evPerRisk } of rankedBuys) {
      const proposalRiskPct = (proposal.size_pct / 100) * riskPerDollar * 100 * regimeMultiplier;
      if (proposalRiskPct <= availableHeat) {
        approvedBuys.push(proposal);
        availableHeat -= proposalRiskPct;
        log.push(`Accepted ${proposal.ticker} BUY: risk ${proposalRiskPct.toFixed(2)}%, EV/risk ${evPerRisk.toFixed(2)}`);
      } else if (availableHeat > 0.5) {
        // Partial fill: reduce size to fit remaining heat budget
        const reducedSizePct = Math.floor((availableHeat / proposalRiskPct) * proposal.size_pct * 0.8); // 80% for safety margin
        if (reducedSizePct >= 3) {
          approvedBuys.push({ ...proposal, size_pct: reducedSizePct });
          log.push(`Partial ${proposal.ticker} BUY: ${proposal.size_pct}% → ${reducedSizePct}% (heat budget)`);
          availableHeat = 0;
        } else {
          log.push(`Rejected ${proposal.ticker} BUY: risk ${proposalRiskPct.toFixed(2)}% > available ${availableHeat.toFixed(2)}%`);
        }
      } else {
        log.push(`Rejected ${proposal.ticker} BUY: insufficient heat budget (${availableHeat.toFixed(2)}%)`);
      }

      // Hard cap: max new positions per cycle
      if (approvedBuys.length >= 3) break;
    }

    // Combine all sell recommendations (dedup by ticker)
    const allSells = [...thesisExits, ...forcedExits];
    const sellMap = new Map<string, OrderProposal>();
    for (const s of allSells) {
      if (!sellMap.has(s.ticker)) {
        sellMap.set(s.ticker, s);
      }
    }

    return {
      approved_proposals: approvedBuys,
      sell_recommendations: [...sellMap.values()],
      portfolio_heat: heat,
      hold_assessments: assessments,
      allocation_log: log,
    };
  }
}

// ── Portfolio Metrics ───────────────────────────────────────
export interface PortfolioMetrics {
  total_equity_usd: number;
  cash_pct: number;
  invested_pct: number;
  portfolio_heat_pct: number;
  max_heat_pct: number;
  position_count: number;
  sector_concentration: Record<string, number>;
  avg_correlation: number | null;
  unrealized_pnl_pct: number;
  daily_pnl_pct: number;
  risk_regime: string;
  opportunity_cost_usd: number; // capital stuck in weak positions
  weak_positions: Array<{ ticker: string; pnl_pct: number; hold_score: number }>;
}

export function computePortfolioMetrics(
  positions: Position[],
  portfolioUsd: number,
  cashUsd: number,
  dailyPnlPct: number,
  riskRegime: string,
  debates: DebateOutput[],
  sectorBiases: Record<string, SectorBias>,
  correlations?: Map<string, number>,
): PortfolioMetrics {
  const heat = computePortfolioHeat(positions, portfolioUsd);
  const assessments = assessHoldOpportunity(positions, debates, sectorBiases);

  const sectorConcentration: Record<string, number> = {};
  for (const pos of positions) {
    const sector = getTickerSector(pos.ticker);
    sectorConcentration[sector] = (sectorConcentration[sector] || 0) + (pos.sizeUsd / portfolioUsd) * 100;
  }

  let avgCorrelation: number | null = null;
  if (correlations && correlations.size > 0) {
    const vals = [...correlations.values()];
    avgCorrelation = vals.reduce((s, v) => s + v, 0) / vals.length;
  }

  // Opportunity cost: capital stuck in positions with negative hold_score or significant underperformance
  const weakPositions = assessments
    .filter((a) => a.hold_score < 0 || (a.pnl_pct < -2 && a.days_held >= 3))
    .map((a) => ({
      ticker: a.ticker,
      pnl_pct: a.pnl_pct,
      hold_score: a.hold_score,
    }));

  const opportunityCostUsd = positions
    .filter((p) => {
      const a = assessments.find((a) => a.ticker === p.ticker);
      return a && (a.hold_score < 0 || (a.pnl_pct < -2 && a.days_held >= 3));
    })
    .reduce((sum, p) => sum + p.sizeUsd, 0);

  const unrealizedPnlPct = positions.reduce((s, p) => s + p.pnlPct * (p.sizeUsd / portfolioUsd), 0);

  return {
    total_equity_usd: portfolioUsd,
    cash_pct: Math.round((cashUsd / portfolioUsd) * 100 * 100) / 100,
    invested_pct: Math.round(((portfolioUsd - cashUsd) / portfolioUsd) * 100 * 100) / 100,
    portfolio_heat_pct: heat.current_heat_pct,
    max_heat_pct: heat.max_heat_pct,
    position_count: positions.length,
    sector_concentration: Object.fromEntries(
      Object.entries(sectorConcentration).map(([k, v]) => [k, Math.round(v * 100) / 100]),
    ),
    avg_correlation: avgCorrelation !== null ? Math.round(avgCorrelation * 1000) / 1000 : null,
    unrealized_pnl_pct: Math.round(unrealizedPnlPct * 100) / 100,
    daily_pnl_pct: dailyPnlPct,
    risk_regime: riskRegime,
    opportunity_cost_usd: Math.round(opportunityCostUsd * 100) / 100,
    weak_positions: weakPositions,
  };
}