import { callLLM, parseJsonResponse } from '../llm/client';
import { getModels } from '../llm/models';
import { buildDeciderPrompt, DECIDER_SYSTEM, type DeciderInputTicker, type DeciderContext } from '../prompts/decider.prompt';
import { broadcastAnalysisEvent } from '../websocket';
import type { AnalystOutput } from './analyst';
import type { CollectorOutput, TickerData } from './collector';
import type { MarketSegment } from './discovery';
import type { AllocationBudget } from './balance-controller';
import type { RegimeAssessment } from './regime';
import type { Position } from '../broker/mock';
import type { OrderProposal } from './strategist';
import { getTickerCalibrations } from '../data/prediction-calibration';

export interface DeciderDecision {
  ticker: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  limit_price: number;
  stop_loss: number;
  take_profit: number;
  size_pct: number;
  trade_type: 'A' | 'B' | 'C';
  confidence: number;
  reasoning: string;
  bull_case: string;
  bear_case: string;
  key_risk: string;
  invalidation: string;
  // Enrichi côté code pour persistence/UI
  analyst_output?: AnalystOutput;
  inputs_seen?: {
    news_count: number;
    news_positive: number;
    news_negative: number;
    has_calibration: boolean;
    calibration_wr?: number;
    is_held: boolean;
    segment?: string;
  };
}

interface NewsLite {
  title?: string;
  sentiment_hint?: string;
}

function buildNewsSummary(news: NewsLite[] | undefined) {
  if (!news || news.length === 0) {
    return { count: 0, positive: 0, negative: 0, titles: [] as string[] };
  }
  const top = news.slice(0, 8);
  let pos = 0, neg = 0;
  for (const n of top) {
    if (n.sentiment_hint === 'positive') pos++;
    else if (n.sentiment_hint === 'negative') neg++;
  }
  return {
    count: top.length,
    positive: pos,
    negative: neg,
    titles: top.map((n) => n.title ?? '').filter((t) => t.length > 0).slice(0, 5),
  };
}

function summarizeFundamentals(fund: unknown): string | undefined {
  if (!fund || typeof fund !== 'object') return undefined;
  const f = fund as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof f.peRatio === 'number') parts.push(`PE ${(f.peRatio as number).toFixed(1)}`);
  if (typeof f.marketCap === 'number') parts.push(`MCap ${((f.marketCap as number) / 1e9).toFixed(1)}B`);
  if (typeof f.dividendYield === 'number') parts.push(`Div ${((f.dividendYield as number) * 100).toFixed(2)}%`);
  if (f.sector) parts.push(`secteur ${f.sector}`);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

/**
 * DeciderAgent — UNIQUE point de décision LLM.
 *
 * Remplace l'ancienne chaîne Researcher (bull+bear) + Strategist par UN seul appel LLM
 * qui reçoit toutes les infos et choisit pour chaque ticker: BUY, SELL ou HOLD.
 *
 * Le risk agent qui suit ne fait que valider chiffré (R/R, vol cap, Kelly, sector, cash).
 */
export class DeciderAgent {
  async run(
    analystOutputs: AnalystOutput[],
    collector: CollectorOutput,
    segments: Record<string, MarketSegment>,
    budget: AllocationBudget,
    regime: RegimeAssessment,
    portfolio: {
      total_usd: number;
      cash_usd: number;
      daily_pnl_pct: number;
      risk_regime: string;
      positions: Position[];
    },
    portfolioUsd: number
  ): Promise<DeciderDecision[]> {
    // Filtrer analyses valides (confidence > 0, data ok)
    const valid = analystOutputs.filter((a) => {
      if (a.confidence <= 0) return false;
      if (a.data_quality === 'missing') return false;
      return true;
    });

    const heldTickers = new Set(portfolio.positions.map((p) => p.ticker));

    // Sélection : top par segment selon slots, + toujours inclure positions tenues
    const selectedTickers = new Set<string>();
    for (const [seg, alloc] of Object.entries(budget.segments) as Array<[MarketSegment, { slots: number; candidates_to_analyze: number }]>) {
      const cap = Math.max(alloc.slots * 3, 5);
      const segAnalyses = valid
        .filter((a) => segments[a.ticker] === seg)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, cap);
      for (const a of segAnalyses) selectedTickers.add(a.ticker);
    }
    // Toujours inclure positions tenues pour décision SELL/HOLD
    for (const t of heldTickers) {
      const has = valid.find((a) => a.ticker === t);
      if (has) selectedTickers.add(t);
    }

    const selectedAnalyses = valid.filter((a) => selectedTickers.has(a.ticker)).slice(0, 15);

    if (selectedAnalyses.length === 0) {
      console.log('[Decider] Aucun ticker à décider');
      return [];
    }

    console.log(`[Decider] Préparation décisions pour ${selectedAnalyses.length} ticker(s)`);

    // Calibration historique
    const calibrations = await getTickerCalibrations(selectedAnalyses.map((a) => a.ticker));

    // Construire l'input par ticker
    const inputs: DeciderInputTicker[] = selectedAnalyses.map((a) => {
      const td = collector.tickers[a.ticker] as TickerData | undefined;
      const isHeld = heldTickers.has(a.ticker);
      const pos = portfolio.positions.find((p) => p.ticker === a.ticker);
      const cal = calibrations[a.ticker];

      return {
        ticker: a.ticker,
        is_held: isHeld,
        segment: segments[a.ticker],
        analyst_output: {
          bias_4h: a.bias_4h,
          bias_1h: a.bias_1h,
          signal_15m: a.signal_15m,
          trade_type: a.trade_type,
          entry_price: a.entry_price,
          stop_loss: a.stop_loss,
          take_profit: a.take_profit,
          atr: a.atr,
          rsi_15m: a.rsi_15m,
          rsi_1h: a.rsi_1h,
          macd_signal: a.macd_signal,
          volume_ratio: a.volume_ratio,
          key_levels: a.key_levels,
          candle_pattern: a.candle_pattern,
          confidence: a.confidence,
          data_freshness_score: a.data_freshness_score,
        },
        current_price: td?.current_price ?? a.entry_price,
        news_summary: buildNewsSummary(td?.news as NewsLite[] | undefined),
        fundamentals_summary: summarizeFundamentals(td?.fundamentals),
        earnings_blackout: td?.earnings_blackout,
        position: pos ? {
          days_held: pos.days_held ?? 0,
          pnl_pct: pos.pnlPct ?? 0,
          entry_conviction: pos.entry_conviction ?? 0,
          size_usd: pos.sizeUsd,
        } : undefined,
        calibration: cal ? { win_rate: cal.win_rate, sample_size: cal.sample_size } : undefined,
      };
    });

    const ctx: DeciderContext = {
      portfolio_usd: portfolioUsd,
      cash_usd: portfolio.cash_usd,
      daily_pnl_pct: portfolio.daily_pnl_pct,
      risk_regime: portfolio.risk_regime,
      held_tickers: Array.from(heldTickers),
      market: {
        vix: collector.market.vix,
        fear_greed: collector.market.fear_greed,
        nasdaq_direction: collector.market.nasdaq_direction,
        sector_biases: collector.market.sector_biases as DeciderContext['market']['sector_biases'],
      },
      regime,
      budget,
    };

    const prompt = buildDeciderPrompt(inputs, ctx);
    const MODELS = await getModels();

    let decisions: DeciderDecision[] = [];

    try {
      const response = await callLLM('decider', MODELS.STRONG, DECIDER_SYSTEM, prompt, 3500);
      const parsed = parseJsonResponse<DeciderDecision[]>(response.content);

      if (!Array.isArray(parsed)) {
        console.warn('[Decider] Réponse non-array, retournant []');
        return [];
      }

      decisions = parsed;
    } catch (err) {
      console.error('[Decider] Erreur LLM:', (err as Error).message);
      return [];
    }

    // Enrichir avec analyst_output complet et inputs_seen pour persistence/UI
    const inputsByTicker = new Map(inputs.map((i) => [i.ticker, i]));
    const analysisByTicker = new Map(selectedAnalyses.map((a) => [a.ticker, a]));

    const enriched = decisions.map((d) => {
      const input = inputsByTicker.get(d.ticker);
      const analysis = analysisByTicker.get(d.ticker);
      return {
        ...d,
        action: ((d.action || 'HOLD').trim() as DeciderDecision['action']),
        analyst_output: analysis,
        inputs_seen: input ? {
          news_count: input.news_summary.count,
          news_positive: input.news_summary.positive,
          news_negative: input.news_summary.negative,
          has_calibration: !!input.calibration,
          calibration_wr: input.calibration?.win_rate,
          is_held: input.is_held,
          segment: input.segment,
        } : undefined,
      };
    });

    // Sanity: refuser BUY sur ticker déjà tenu (le LLM peut se tromper)
    const cleaned = enriched.filter((d) => {
      if (d.action === 'BUY' && heldTickers.has(d.ticker)) {
        console.warn(`[Decider] Rejet BUY ${d.ticker}: déjà tenu`);
        return false;
      }
      if (d.action === 'SELL' && !heldTickers.has(d.ticker)) {
        console.warn(`[Decider] Rejet SELL ${d.ticker}: non tenu`);
        return false;
      }
      return true;
    });

    const counts = { BUY: 0, SELL: 0, HOLD: 0 };
    for (const d of cleaned) counts[d.action]++;
    console.log(`[Decider] Décisions: ${counts.BUY} BUY, ${counts.SELL} SELL, ${counts.HOLD} HOLD`);

    // Broadcast UI events
    for (const d of cleaned) {
      const icon = d.action === 'BUY' ? '🟢' : d.action === 'SELL' ? '🔴' : '⚪';
      broadcastAnalysisEvent({
        id: `decision-${d.ticker}-${Date.now()}`,
        timestamp: new Date().toISOString(),
        agent: 'strategist',
        stage: 'decision',
        title: `${icon} ${d.ticker} — ${d.action}`,
        summary_simple: d.reasoning,
        summary_expert: `${d.action} conf ${d.confidence}% | ${d.bull_case} | ${d.bear_case}`,
        confidence: d.confidence,
        ticker: d.ticker,
      });
    }

    return cleaned;
  }
}

/**
 * Convertit les décisions LLM en OrderProposal pour passage au Risk agent.
 * Les HOLD sont ignorés. Les BUY/SELL deviennent des propositions chiffrées.
 */
export function decisionsToProposals(decisions: DeciderDecision[]): OrderProposal[] {
  const proposals: OrderProposal[] = [];
  for (const d of decisions) {
    if (d.action === 'HOLD') continue;

    proposals.push({
      ticker: d.ticker,
      action: d.action,
      trade_type: d.trade_type,
      limit_price: d.limit_price,
      stop_loss: d.stop_loss,
      take_profit: d.take_profit,
      invalidation_condition: d.invalidation,
      size_pct: d.size_pct,
      confidence: d.confidence,
      debate_score: 0, // calculé en aval si besoin
      bull_conviction: 0,
      bear_conviction: 0,
      reasoning: d.reasoning,
    });
  }
  return proposals;
}
