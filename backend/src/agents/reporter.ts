import { broadcastCycleUpdate, broadcastAlert, AgentState, CycleUpdatePayload } from '../websocket';
import type { DebateOutput } from './researcher';
import type { ExecutionResult } from '../broker/mock';
import { callLLM, parseJsonResponse } from '../llm/client';
import { getModels } from '../llm/models';
import { prisma } from '../lib/prisma';
import { getYahooCurrentPrice } from '../data/yahoo';
import { getNasdaqStatus } from '../routes/market';

const REPORTER_SYSTEM = `Tu es le rapporteur du cycle de trading automatisé. Résume le cycle et génère les alertes importantes.
IMPORTANT: Toutes les alertes et le résumé DOIVENT être rédigés en français naturel, compréhensible par un non-expert.
Explique les décisions en termes simples : "Le système a acheté NVDA car la tendance est haussière et les analystes IA sont optimistes."
Output JSON uniquement: { "alerts": [{ "level": "info|warning|critical", "message": "", "ticker": "" }], "summary": "" }`;

export class ReporterAgent {
  private agentStates: CycleUpdatePayload['agents'] = {
    collector: { status: 'idle' },
    analyst: { status: 'idle' },
    bull: { status: 'idle' },
    bear: { status: 'idle' },
    strategist: { status: 'idle' },
    risk: { status: 'idle' },
    reporter: { status: 'idle' },
  };

  updateAgent(name: keyof CycleUpdatePayload['agents'], state: AgentState) {
    this.agentStates[name] = { ...this.agentStates[name], ...state };

    // Only broadcast agent status — don't wipe portfolio/market data
    broadcastCycleUpdate({
      agents: this.agentStates,
    } as any);
  }

  async finalize(
    cycleStart: number,
    debates: DebateOutput[],
    execResults: ExecutionResult[],
    portfolioUsd: number,
    dailyLossLimitPct: number,
    portfolio?: CycleUpdatePayload['portfolio'],
    market?: { vix: number; fear_greed: number; nasdaq_direction: string; nasdaq_change_pct?: number; macro?: any; sector_biases?: any },
    watchlist?: string[]
  ) {
    const durationMs = Date.now() - cycleStart;

    const signals: CycleUpdatePayload['signals'] = debates.map((d) => ({
      ticker: d.ticker,
      signal: d.debate_score >= 1 ? 'BUY' : d.debate_score <= -2 ? 'SELL' : 'HOLD',
      debate_score: d.debate_score,
      bull_conviction: d.bull.conviction,
      bear_conviction: d.bear.conviction,
      confidence: d.analyst_output.confidence,
      reasoning: d.bull.technical_case?.slice(0, 80) || '',
    }));

    const orders_executed: CycleUpdatePayload['orders_executed'] = execResults.map((r) => ({
      ticker: r.ticker,
      action: r.action,
      filledPrice: r.filled_price,
      sizeUsd: r.size_usd,
      orderId: r.order_id,
    }));

    // Alertes en français naturel
    let alerts: CycleUpdatePayload['alerts'] = [];

    for (const result of execResults) {
      const actionFr = result.action === 'BUY' ? 'acheté' : 'vendu';
      alerts.push({
        level: 'info',
        message: `Le système IA a ${actionFr} ${result.ticker} à $${result.filled_price.toFixed(2)} — Montant investi : $${result.size_usd.toFixed(0)}`,
        ticker: result.ticker,
      });
    }

    // Alerte régime de risque
    if (portfolio?.risk_regime === 'CRISIS') {
      alerts.push({
        level: 'critical',
        message: `⚠️ RÉGIME DE CRISE — Perte journalière dépasse la limite. Aucun nouvel achat autorisé.`,
      });
    } else if (portfolio?.risk_regime === 'ELEVATED') {
      alerts.push({
        level: 'warning',
        message: `Régime de risque ÉLEVÉ — Pertes journalières importantes. Prudence recommandée.`,
      });
    }

    // LLM reporter pour résumé enrichi
    try {
      const MODELS = await getModels();
      const summary = {
        debates: debates.length,
        orders: execResults.length,
        duration_ms: durationMs,
        regime: market ? `VIX ${market.vix?.toFixed(1)} Fear&Greed ${market.fear_greed}` : '',
        macro: (market as any)?.macro?.summary || '',
      };
      const response = await callLLM(
        'reporter',
        MODELS.LIGHT,
        REPORTER_SYSTEM,
        `Résumé cycle: ${JSON.stringify(summary)}\nSignaux principaux: ${JSON.stringify(signals.slice(0, 5))}\nOrdres exécutés: ${JSON.stringify(orders_executed)}`
      );
      const parsed = parseJsonResponse<{ alerts: CycleUpdatePayload['alerts']; summary: string }>(response.content);
      if (parsed.alerts) alerts = [...alerts, ...parsed.alerts];
    } catch {
      // Non-critique
    }

    // Sauvegarder AgentPredictions pour feedback loop
    if (watchlist && debates.length > 0) {
      await this.saveAgentPredictions(debates, watchlist).catch((err) =>
        console.error('[Reporter] Failed to save predictions:', err)
      );
      // Résoudre prédictions 5 jours+ passées
      await this.resolveOldPredictions().catch(() => {});
    }

    const finalPortfolio: CycleUpdatePayload['portfolio'] = portfolio || {
      total_usd: portfolioUsd,
      cash_usd: portfolioUsd,
      daily_pnl_pct: 0,
      risk_regime: 'NORMAL',
      initial_capital: portfolioUsd,
      positions: [],
    };

    broadcastCycleUpdate({
      portfolio: finalPortfolio,
      market: {
        vix: market?.vix || 0,
        fear_greed: market?.fear_greed || 0,
        nasdaq: market?.nasdaq_direction || 'neutral',
        nasdaq_change_pct: (market as any)?.nasdaq_change_pct || 0,
        nasdaq_status: getNasdaqStatus(),
        macro: (market as any)?.macro || null,
        sector_biases: (market as any)?.sector_biases || null,
      } as any,
      signals,
      orders_executed,
      alerts,
      agents: this.agentStates,
    });

    for (const alert of alerts.filter((a) => a.level === 'critical')) {
      broadcastAlert('critical', alert.message, alert.ticker);
    }

    console.log(`[Reporter] Cycle broadcast — ${signals.length} signaux, ${orders_executed.length} ordres, ${alerts.length} alertes, ${durationMs}ms`);
  }

  private async saveAgentPredictions(debates: DebateOutput[], watchlist: string[]): Promise<void> {
    const cycleId = `cycle-${Date.now()}`;
    const toCreate = debates.map((d) => ({
      cycleId,
      ticker: d.ticker,
      predictedDirection: d.debate_score >= 1 ? 'BUY' : d.debate_score <= -2 ? 'SELL' : 'HOLD',
      confidence: d.analyst_output.confidence,
      debateScore: d.debate_score,
      bullConviction: d.bull.conviction,
      bearConviction: d.bear.conviction,
      priceAtPrediction: 0, // Sera mis à jour par resolveOldPredictions si possible
    }));

    // Récupérer les prix actuels en parallèle
    const prices = await Promise.allSettled(
      debates.map((d) => getYahooCurrentPrice(d.ticker))
    );

    for (let i = 0; i < toCreate.length; i++) {
      const settled = prices[i];
      const price = settled.status === 'fulfilled' ? settled.value : null;
      if (price) toCreate[i].priceAtPrediction = price;
    }

    await (prisma as any).agentPrediction.createMany({ data: toCreate, skipDuplicates: true });
    console.log(`[Reporter] Saved ${toCreate.length} predictions for cycle ${cycleId}`);
  }

  private async resolveOldPredictions(): Promise<void> {
    const fiveDaysAgo = new Date(Date.now() - 5 * 86400 * 1000);
    const pending = await (prisma as any).agentPrediction.findMany({
      where: { resolvedAt: null, createdAt: { lte: fiveDaysAgo } },
      take: 20,
    });

    if (pending.length === 0) return;

    for (const pred of pending) {
      try {
        const currentPrice = await getYahooCurrentPrice(pred.ticker);
        if (!currentPrice || !pred.priceAtPrediction) continue;

        const actualReturn = ((currentPrice - pred.priceAtPrediction) / pred.priceAtPrediction) * 100;
        const correct =
          (pred.predictedDirection === 'BUY' && actualReturn > 0.5) ||
          (pred.predictedDirection === 'SELL' && actualReturn < -0.5) ||
          (pred.predictedDirection === 'HOLD' && Math.abs(actualReturn) <= 0.5);

        await (prisma as any).agentPrediction.update({
          where: { id: pred.id },
          data: { actualReturn5d: actualReturn, correct, resolvedAt: new Date() },
        });
      } catch {
        // Ignorer erreurs individuelles
      }
    }

    console.log(`[Reporter] Resolved ${pending.length} old predictions`);
  }
}
