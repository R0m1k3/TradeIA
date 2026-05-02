import { broadcastCycleUpdate, broadcastAlert, AgentState, CycleUpdatePayload } from '../websocket';
import type { DebateOutput } from './researcher';
import type { ExecutionResult } from '../broker/mock';
import { callLLM, parseJsonResponse } from '../llm/client';
import { getModels } from '../llm/models';

const REPORTER_SYSTEM = `You are the trading cycle reporter. Summarize the completed cycle and generate any necessary alerts.
IMPORTANT: All alert messages and the summary MUST be written in French.
Output JSON only: { "alerts": [{ "level": "info|warning|critical", "message": "", "ticker": "" }], "summary": "" }`;

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

    // Broadcast partial update for real-time agent status
    broadcastCycleUpdate({
      portfolio: {
        total_usd: 0,
        cash_usd: 0,
        daily_pnl_pct: 0,
        risk_regime: 'NORMAL',
        positions: [],
      },
      market: { vix: 0, fear_greed: 0, nasdaq: '' },
      signals: [],
      orders_executed: [],
      alerts: [],
      agents: this.agentStates,
    });
  }

  async finalize(
    cycleStart: number,
    debates: DebateOutput[],
    execResults: ExecutionResult[],
    portfolioUsd: number,
    dailyLossLimitPct: number,
    portfolio?: CycleUpdatePayload['portfolio'],
    market?: { vix: number; fear_greed: number; nasdaq_direction: string }
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

    let alerts: CycleUpdatePayload['alerts'] = [];

    // Generate alerts from execution results
    for (const result of execResults) {
      alerts.push({
        level: 'info',
        message: `${result.action} ${result.ticker} @ $${result.filled_price.toFixed(2)} — $${result.size_usd.toFixed(0)}`,
        ticker: result.ticker,
      });
    }

    // LLM reporter for advanced alerts
    try {
      const MODELS = await getModels();
      const summary = { debates: debates.length, orders: execResults.length, duration_ms: durationMs };
      const response = await callLLM(
        'reporter',
        MODELS.LIGHT,
        REPORTER_SYSTEM,
        `Cycle summary: ${JSON.stringify(summary)}\nSignals: ${JSON.stringify(signals.slice(0, 5))}`
      );
      const parsed = parseJsonResponse<{ alerts: CycleUpdatePayload['alerts']; summary: string }>(response.content);
      if (parsed.alerts) alerts = [...alerts, ...parsed.alerts];
    } catch {
      // Reporter failure is non-critical
    }

    const finalPortfolio: CycleUpdatePayload['portfolio'] = portfolio || {
      total_usd: portfolioUsd,
      cash_usd: portfolioUsd,
      daily_pnl_pct: 0,
      risk_regime: 'NORMAL',
      positions: [],
    };

    broadcastCycleUpdate({
      portfolio: finalPortfolio,
      market: {
        vix: market?.vix || 0,
        fear_greed: market?.fear_greed || 0,
        nasdaq: market?.nasdaq_direction || 'neutral',
      },
      signals,
      orders_executed,
      alerts,
      agents: this.agentStates,
    });

    for (const alert of alerts.filter((a) => a.level === 'critical')) {
      broadcastAlert('critical', alert.message, alert.ticker);
    }

    console.log(`[Reporter] Cycle broadcast complete — ${signals.length} signals, ${orders_executed.length} orders, ${alerts.length} alerts`);
  }
}
