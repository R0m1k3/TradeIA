import { DiscoveryAgent } from './discovery';
import { CollectorAgent } from './collector';
import { AnalystAgent } from './analyst';
import { DeciderAgent, decisionsToProposals, type DeciderDecision } from './decider';
import { RiskAgent } from './risk';
import { ReporterAgent } from './reporter';
import { BalanceController } from './balance-controller';
import type { AllocationBudget } from './balance-controller';
import { classifyRegime } from './regime';
import { executeOrder, getPortfolioState, markToMarket, closeTrade, updateEquityPeak } from '../broker/mock';
import { detectStrategyDecay } from '../broker/backtest';
import { prisma } from '../lib/prisma';
import { getCredential } from '../config/credentials';
import { broadcastAlert, broadcastAnalysisEvent } from '../websocket';
import { getNasdaqStatus } from '../routes/market';
import { isEuropeanMarketOpen } from '../data/european-markets';
import { getYahooVIX, getFearAndGreed } from '../data/yahoo';
import { getTickerSector } from '../data/sectors';
import type { OrderProposal } from './strategist';
import type { DebateOutput, BullOutput, BearOutput } from './researcher';
import type { AnalystOutput } from './analyst';
import type { MarketSegment } from './discovery';
import type { SectorBias } from '../data/sectors';
import type { Position } from '../broker/mock';
import { computePortfolioMetrics } from './portfolio-allocator';
import { saveSnapshots } from '../models/ticker-snapshot';
import { saveNotes } from '../models/ticker-note';
import { AILogCollector } from '../utils/ai-logger';
import { resetTokenBudget, getCycleTokensUsed } from '../llm/client';

/**
 * Convertit les décisions du Decider en DebateOutput pour rétrocompat
 * avec reporter.finalize (AgentPrediction logging) et UI legacy.
 */
function decisionsToDebates(decisions: DeciderDecision[]): DebateOutput[] {
  return decisions
    .filter((d) => d.analyst_output)
    .map((d) => {
      // Convertir action → conviction bull/bear (1-10)
      const bullConv = d.action === 'BUY' ? Math.max(6, Math.round(d.confidence / 10)) : d.action === 'HOLD' ? 4 : 2;
      const bearConv = d.action === 'SELL' ? Math.max(6, Math.round(d.confidence / 10)) : d.action === 'HOLD' ? 4 : 2;

      const upsidePct = d.limit_price > 0 && d.take_profit > 0
        ? ((d.take_profit - d.limit_price) / d.limit_price) * 100
        : 0;
      const downsidePct = d.limit_price > 0 && d.stop_loss > 0
        ? ((d.limit_price - d.stop_loss) / d.limit_price) * 100
        : 0;

      const bull: BullOutput = {
        ticker: d.ticker,
        upside_pct: Math.max(0, Math.round(upsidePct * 100) / 100),
        technical_case: d.bull_case,
        fundamental_catalyst: '',
        sentiment_driver: '',
        bear_rebuttal_1: '',
        bear_rebuttal_2: '',
        conviction: bullConv,
        invalidation_condition: d.invalidation,
        key_risk: d.key_risk,
      };

      const bear: BearOutput = {
        ticker: d.ticker,
        downside_pct: Math.max(0, Math.round(downsidePct * 100) / 100),
        technical_case: d.bear_case,
        structural_weakness: '',
        macro_headwind: '',
        bull_rebuttal_1: '',
        bull_rebuttal_2: '',
        conviction: bearConv,
        invalidation_condition: d.invalidation,
        strongest_bull_argument: d.bull_case,
      };

      return {
        ticker: d.ticker,
        bull,
        bear,
        debate_score: bullConv - bearConv,
        analyst_output: d.analyst_output as AnalystOutput,
      };
    });
}

const CYCLE_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hours max par cycle

/**
 * Strategy decay monitor — runs at most once per day.
 * If recent 30 trades win-rate < 50% of historical 60 trades, flag and broadcast critical alert.
 * Does NOT auto-pause (operator decision) but logs prominently.
 */
async function maybeRunDecayCheck(reporter: ReporterAgent): Promise<void> {
  try {
    const last = await prisma.config.findUnique({ where: { key: 'last_decay_check' } });
    const lastMs = last ? new Date(last.value).getTime() : 0;
    if (Date.now() - lastMs < 24 * 3600 * 1000) return;

    const decay = await detectStrategyDecay();
    await prisma.config.upsert({
      where: { key: 'last_decay_check' },
      update: { value: new Date().toISOString() },
      create: { key: 'last_decay_check', value: new Date().toISOString() },
    });

    if (decay.decay_detected) {
      console.error(`[Orchestrator] ${decay.message}`);
      // Auto-pause sur decay détecté: le système ne doit pas continuer à perdre.
      // L'opérateur peut reprendre via POST /api/override/resume après analyse.
      await prisma.config.upsert({
        where: { key: 'system_paused' },
        update: { value: 'true' },
        create: { key: 'system_paused', value: 'true' },
      });
      await prisma.config.upsert({
        where: { key: 'paused_reason' },
        update: { value: `decay_auto: ${decay.message}` },
        create: { key: 'paused_reason', value: `decay_auto: ${decay.message}` },
      });
      broadcastAlert('critical', `⚠️ STRATEGY DECAY — Trading auto-suspendu. ${decay.message}`);
      reporter.updateAgent('reporter', { status: 'error', error: decay.message });
    } else {
      console.log(`[Orchestrator] Decay check OK: ${decay.message}`);
    }
  } catch (err) {
    console.warn('[Orchestrator] Decay check failed:', (err as Error).message);
  }
}

/**
 * Relative weakness exit: si le secteur monte fortement (+1.5%) mais la position est dans le rouge,
 * c'est un signal de fuite de capitaux → vendre défensivement.
 */
function generateWeaknessExits(
  positions: Position[],
  sectorBiases: Record<string, SectorBias>
): OrderProposal[] {
  const sells: OrderProposal[] = [];
  for (const pos of positions) {
    const daysHeld = pos.days_held ?? 0;
    const pnlPct = pos.pnlPct ?? 0;
    if (daysHeld < 2) continue;   // Au moins 2 jours — laisse le setup respirer
    if (pnlPct >= 0) continue;    // Position en profit → garder
    if (pnlPct > -2) continue;    // Bruit < 2%, pas une vraie faiblesse
    const sector = getTickerSector(pos.ticker);
    const bias = sectorBiases[sector];
    if (!bias || bias.direction !== 'bullish' || bias.change_pct < 3.0) continue;
    // Secteur +3% mais position rouge ≥ 2j = vraie faiblesse relative
    console.log(`[Orchestrator] Faiblesse relative: ${pos.ticker} ${pnlPct.toFixed(1)}% vs secteur ${sector} +${bias.change_pct.toFixed(1)}%`);
    sells.push({
      ticker: pos.ticker,
      action: 'SELL',
      trade_type: 'C',
      limit_price: pos.currentPrice,
      stop_loss: 0,
      take_profit: 0,
      invalidation_condition: `Faiblesse relative vs secteur ${sector}`,
      size_pct: 100,
      confidence: 75,
      debate_score: 0,
      bull_conviction: 1,
      bear_conviction: 8,
      reasoning: `Faiblesse relative: secteur ${sector} +${bias.change_pct.toFixed(1)}% (${bias.etf}) mais ${pos.ticker} à ${pnlPct.toFixed(1)}% après ${daysHeld.toFixed(0)}j. Vente défensive.`,
    });
  }
  return sells;
}


let isRunning = false;

function cycleTimeout(): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Cycle timeout after 4 hours')), CYCLE_TIMEOUT_MS)
  );
}

async function checkCircuitBreaker(
  portfolioUsd: number,
  maxDrawdownPct: number,
  reporter: ReporterAgent
): Promise<boolean> {
  const portfolio = await getPortfolioState(portfolioUsd);

  // Drawdown from equity peak (not initial capital)
  const drawdownPct = portfolio.drawdown_from_peak_pct;
  const drawdownFromCapital = ((portfolio.initial_capital - portfolio.total_usd) / portfolio.initial_capital) * 100;

  if (drawdownPct <= -maxDrawdownPct || drawdownFromCapital >= maxDrawdownPct) {
    console.error(`[Orchestrator] CIRCUIT BREAKER: drawdown-from-peak ${drawdownPct.toFixed(2)}%, from-capital ${drawdownFromCapital.toFixed(2)}%`);

    // Fermer toutes les positions ouvertes
    const openTrades = await prisma.trade.findMany({ where: { closedAt: null, action: 'BUY' } });
    for (const trade of openTrades) {
      await closeTrade(trade.id, trade.filledPrice, 'CIRCUIT_BREAKER');
    }

    // Pause forcée via config
    await prisma.config.upsert({
      where: { key: 'system_paused' },
      update: { value: 'true' },
      create: { key: 'system_paused', value: 'true' },
    });
    await prisma.config.upsert({
      where: { key: 'circuit_breaker_triggered_at' },
      update: { value: new Date().toISOString() },
      create: { key: 'circuit_breaker_triggered_at', value: new Date().toISOString() },
    });

    broadcastAlert('critical',
      `🚨 CIRCUIT BREAKER — Drawdown pic ${drawdownPct.toFixed(2)}% — ${openTrades.length} positions fermées — Trading suspendu`
    );

    reporter.updateAgent('reporter', { status: 'error', error: 'Circuit breaker triggered' });
    return true;
  }
  return false;
}

async function runPipelineInternal(reporter: ReporterAgent): Promise<void> {
  const cycleStart = Date.now();
  resetTokenBudget();

  const portfolioUsdRaw = await getCredential('portfolio_usd', 'PORTFOLIO_USD');
  const portfolioUsd = parseFloat(portfolioUsdRaw || '10000');
  const lossLimitRaw = await getCredential('daily_loss_limit_pct', 'DAILY_LOSS_LIMIT_PCT');
  const dailyLossLimitPct = parseFloat(lossLimitRaw || '3');
  const maxDrawdownRaw = await getCredential('max_drawdown_pct', 'MAX_DRAWDOWN_PCT');
  const maxDrawdownPct = parseFloat(maxDrawdownRaw || '10');
  console.log(`[Orchestrator] === CYCLE START (Capital: $${portfolioUsd}) ===`, new Date().toISOString());

  const aiLog = new AILogCollector(cycleStart);

  reporter.updateAgent('collector', { status: 'running' });

  // Step 1: Mark to market positions existantes
  await markToMarket();

  // Step 2: Circuit breaker check
  const circuitTriggered = await checkCircuitBreaker(portfolioUsd, maxDrawdownPct, reporter);
  if (circuitTriggered) {
    await reporter.finalize(cycleStart, [], [], portfolioUsd, dailyLossLimitPct);
    return;
  }

  // Step 3: Get portfolio state early (needed for balance controller)
  const portfolioForBudget = await getPortfolioState(portfolioUsd);

  // Step 3a: Get market context for balance controller
  const nasdaq = getNasdaqStatus();
  const euOpen = isEuropeanMarketOpen(new Date());
  const vix = await getYahooVIX() ?? 20;
  const fearGreed = await getFearAndGreed() ?? 50;

  // Step 3a.1: Classify market regime — drives sizing + strategy preference
  const regime = await classifyRegime(vix);
  console.log(`[Orchestrator] Regime: ${regime.regime} (conf ${regime.confidence}) — ${regime.reason}`);

  // Step 3a.2: Strategy decay check (1× per day)
  await maybeRunDecayCheck(reporter);

  // Step 3b: Compute allocation budget — regime affects total slot count
  const balanceController = new BalanceController();
  const budget = balanceController.compute({
    nasdaq_open: nasdaq.isOpen,
    eu_open: euOpen,
    vix,
    fear_greed: fearGreed,
    existing_positions: portfolioForBudget.positions.map((p) => ({
      ticker: p.ticker,
      segment: undefined as MarketSegment | undefined,
    })),
    segments_map: {},
    regime,
  });

  // Step 4: Discovery (budget-aware)
  reporter.updateAgent('collector', { status: 'running' });
  const discovery = new DiscoveryAgent();
  const discoveryResult = await discovery.run(budget);

  // Fix existing positions segment mapping now that we have segments
  const budgetWithSegments = balanceController.compute({
    nasdaq_open: nasdaq.isOpen,
    eu_open: euOpen,
    vix,
    fear_greed: fearGreed,
    existing_positions: portfolioForBudget.positions.map((p) => ({
      ticker: p.ticker,
      segment: discoveryResult.segments[p.ticker],
    })),
    segments_map: discoveryResult.segments,
    regime,
  });

  // Feed market + budget + discovery into AI log
  aiLog.setMarket({
    vix,
    fear_greed: fearGreed,
    nasdaq_direction: '',
    nasdaq_open: nasdaq.isOpen,
    eu_open: euOpen,
    regime: regime.regime,
  });
  aiLog.setBudget(budgetWithSegments);
  aiLog.setDiscovery(discoveryResult.tickers, discoveryResult.segments);
  aiLog.setPortfolio({
    total_usd: portfolioForBudget.total_usd ?? portfolioUsd,
    cash_usd: portfolioForBudget.cash_usd,
    daily_pnl_pct: portfolioForBudget.daily_pnl_pct ?? 0,
    risk_regime: portfolioForBudget.risk_regime ?? 'NORMAL',
    positions_count: portfolioForBudget.positions.length,
  });

  if (discoveryResult.tickers.length === 0) {
    console.log('[Orchestrator] Discovery returned no active assets, ending cycle');
    await reporter.finalize(cycleStart, [], [], portfolioUsd, dailyLossLimitPct);
    return;
  }

  console.log(`[Orchestrator] Processing ${discoveryResult.tickers.length} tickers`);

  // Step 5: Collect data
  const collector = new CollectorAgent();
  const collectorOutput = await collector.run(discoveryResult.tickers);
  reporter.updateAgent('collector', {
    status: collectorOutput ? 'ok' : 'error',
    lastRun: new Date().toISOString(),
  });

  if (collectorOutput) {
    const tickerCount = Object.keys(collectorOutput.tickers).length;
    broadcastAnalysisEvent({
      id: `collect-${Date.now()}`,
      timestamp: new Date().toISOString(),
      agent: 'collector',
      stage: 'collect',
      title: `Données collectées — ${tickerCount} tickers`,
      summary_simple: `Le collecteur a récupéré les données OHLCV, fondamentaux et macro pour ${tickerCount} actifs.`,
      summary_expert: `VIX ${collectorOutput.market.vix?.toFixed(1)}, Fear&Greed ${collectorOutput.market.fear_greed}, Taux Fed ${(collectorOutput.market.macro as any)?.fed_funds_rate ?? '—'}%, Courbe ${(collectorOutput.market.macro as any)?.yield_curve ?? '—'}%.`,
      freshness_score: collectorOutput.market.data_freshness?.score,
    });
  }

  if (!collectorOutput) {
    console.error('[Orchestrator] Collector failed, aborting cycle');
    await reporter.finalize(cycleStart, [], [], portfolioUsd, dailyLossLimitPct);
    return;
  }

  // Persist latest OHLCV bars for history tracking
  for (const [ticker, data] of Object.entries(collectorOutput.tickers)) {
    if ((data.ohlcv_1h as any[])?.length > 0) {
      await saveSnapshots(ticker, '1h', data.ohlcv_1h as any);
    }
  }

  // Step 6: Technical analysis
  reporter.updateAgent('analyst', { status: 'running' });
  const analyst = new AnalystAgent();
  const analystOutputs = await analyst.run(collectorOutput);
  reporter.updateAgent('analyst', { status: 'ok', lastRun: new Date().toISOString() });

  if (analystOutputs.length > 0) {
    const topBuy = analystOutputs.filter((a) => a.signal_15m === 'BUY').slice(0, 3).map((a) => a.ticker).join(', ');
    const topSell = analystOutputs.filter((a) => a.signal_15m === 'SELL').slice(0, 3).map((a) => a.ticker).join(', ');
    broadcastAnalysisEvent({
      id: `analyst-${Date.now()}`,
      timestamp: new Date().toISOString(),
      agent: 'analyst',
      stage: 'analyze',
      title: `Analyse technique — ${analystOutputs.length} tickers`,
      summary_simple: `Analyste technique: ${analystOutputs.filter((a) => a.signal_15m === 'BUY').length} signaux haussiers, ${analystOutputs.filter((a) => a.signal_15m === 'SELL').length} baissiers sur ${analystOutputs.length} tickers.`,
      summary_expert: `BUY: ${topBuy || 'aucun'} | SELL: ${topSell || 'aucun'} | Confiance moy. ${Math.round(analystOutputs.reduce((s, a) => s + a.confidence, 0) / analystOutputs.length)}%`,
    });
  }

  // Persist technical analysis notes
  if (analystOutputs.length > 0) {
    const techNotes = analystOutputs.map((a) => ({
      ticker: a.ticker,
      noteType: 'technique',
      content: `Signal ${a.signal_15m}, biais 4H/1H ${a.bias_4h}/${a.bias_1h}, RSI ${a.rsi_15m}, MACD ${a.macd_signal}, pattern ${a.candle_pattern}.`,
      confidence: a.confidence,
      metadata: {
        rsi_15m: a.rsi_15m,
        rsi_1h: a.rsi_1h,
        macd_signal: a.macd_signal,
        volume_ratio: a.volume_ratio,
        trade_type: a.trade_type,
        atr: a.atr,
      },
    }));
    await saveNotes(techNotes).catch((err) => console.warn('[Orchestrator] Failed to save tech notes:', err));
  }

  aiLog.setAnalysis(analystOutputs);

  // Log analyst-stage filtering to explain why proposals_raw may be empty
  {
    type AnalystOut = { ticker: string; signal_15m: string; bias_4h: string; bias_1h: string; confidence: number; skip_reason: string | null; data_freshness_score?: number };
    const ao = analystOutputs as AnalystOut[];
    // Regime-aware confidence penalty: never skip bearish setups in bull regime —
    // they are pullback/mean-reversion opportunities (strategist rule 8).
    // Apply a -5 confidence penalty to flag contrarian entry risk.
    const regimePenalties: Array<{ ticker: string; reason: string }> = [];
    if (regime.prefer_momentum) {
      for (const a of ao) {
        const bias4h = (a.bias_4h || '').trim();
        if (bias4h === 'BEARISH' && a.confidence > 0) {
          a.confidence = Math.max(0, a.confidence - 5);
          regimePenalties.push({ ticker: a.ticker, reason: `bull regime: -5 confidence for BEARISH 4H` });
        }
      }
    }
    if (regimePenalties.length > 0) {
      console.log(`[Orchestrator] Regime penalty (${regime.regime}): ${regimePenalties.length} BEARISH-bias tickers got -5 confidence`);
    }

    const skipped = ao.filter((a) => !!a.skip_reason);
    const signalDist: Record<string, number> = {};
    const biasDist: Record<string, number> = {};
    for (const a of ao) {
      const sig = (a.signal_15m || '').trim();
      const bias = (a.bias_4h || '').trim();
      signalDist[sig] = (signalDist[sig] || 0) + 1;
      biasDist[bias] = (biasDist[bias] || 0) + 1;
    }
    const avgConf = ao.length > 0 ? Math.round(ao.reduce((s, a) => s + a.confidence, 0) / ao.length) : 0;
    const avgFresh = ao.length > 0 ? Math.round(ao.reduce((s, a) => s + (a.data_freshness_score ?? 0), 0) / ao.length) : 0;
    console.log(`[Orchestrator] Analyst filter: ${ao.length} total, ${ao.length - skipped.length} actionable, ${skipped.length} skipped — signals: ${JSON.stringify(signalDist)}, 4H bias: ${JSON.stringify(biasDist)}`);
    aiLog.setAnalystFilter({
      total: ao.length,
      actionable: ao.length - skipped.length,
      skipped: skipped.map((a) => ({
        ticker: a.ticker,
        reason: a.skip_reason ?? 'NEUTRAL signal',
        confidence: a.confidence,
        signal_15m: (a.signal_15m || '').trim(),
        bias_4h: (a.bias_4h || '').trim(),
      })),
      signal_distribution: signalDist,
      bias_4h_distribution: biasDist,
      avg_confidence: avgConf,
      avg_freshness_score: avgFresh,
    });
  }

  // Step 7: DECIDER — unique appel LLM qui réfléchit et choisit
  // BUY/SELL/HOLD pour chaque ticker à partir de TOUTES les infos.
  reporter.updateAgent('strategist', { status: 'running' });
  const portfolio = await getPortfolioState(portfolioUsd);
  const heldTickers = portfolio.positions.map((p) => p.ticker);

  console.log(`[Orchestrator] DECIDER INPUT: ${analystOutputs.length} analyses, ${heldTickers.length} held, ${budgetWithSegments.total_new_slots} free slots, regime=${regime.regime}`);

  const decider = new DeciderAgent();
  let deciderDecisions: DeciderDecision[] = [];
  let deciderError: string | undefined;
  try {
    deciderDecisions = await decider.run(
      analystOutputs,
      collectorOutput,
      discoveryResult.segments,
      budgetWithSegments,
      regime,
      portfolio,
      portfolioUsd,
    );
  } catch (err) {
    console.error('[Orchestrator] Decider exception:', (err as Error).message);
    deciderError = (err as Error).message;
  }
  reporter.updateAgent('strategist', {
    status: deciderError ? 'error' : 'ok',
    lastRun: new Date().toISOString(),
    error: deciderError,
  });

  // Persister chaque décision LLM avec son reasoning et inputs vus
  if (deciderDecisions.length > 0) {
    const decisionNotes = deciderDecisions.map((d) => ({
      ticker: d.ticker,
      noteType: 'decision',
      content: d.reasoning,
      confidence: d.confidence,
      metadata: {
        action: d.action,
        size_pct: d.size_pct,
        limit_price: d.limit_price,
        stop_loss: d.stop_loss,
        take_profit: d.take_profit,
        trade_type: d.trade_type,
        bull_case: d.bull_case,
        bear_case: d.bear_case,
        key_risk: d.key_risk,
        invalidation: d.invalidation,
        inputs_seen: d.inputs_seen,
      },
    }));
    await saveNotes(decisionNotes).catch((err) => console.warn('[Orchestrator] Failed to save decision notes:', err));
  }

  // Construire DebateOutput synthétiques pour rétrocompat (AgentPrediction, UI legacy)
  const debateOutputs = decisionsToDebates(deciderDecisions);

  // Convertir décisions BUY/SELL en propositions chiffrées
  const orderProposals = decisionsToProposals(deciderDecisions);

  // Injection déterministe: faiblesse relative (vente défensive)
  const weakSells = generateWeaknessExits(portfolio.positions, collectorOutput.market.sector_biases);
  if (weakSells.length > 0) {
    console.log(`[Orchestrator] ${weakSells.length} vente(s) faiblesse relative injectée(s)`);
  }
  const allProposals: OrderProposal[] = [...orderProposals, ...weakSells];
  aiLog.setProposals(allProposals);

  // preCheckedProposals = toutes les propositions (le risk agent fera la validation chiffrée finale)
  const preCheckedProposals = allProposals;
  const sectorBiases = (collectorOutput.market.sector_biases ?? {}) as Record<string, SectorBias>;

  // Compute and broadcast portfolio metrics
  const portfolioMetrics = computePortfolioMetrics(
    portfolio.positions,
    portfolioUsd,
    portfolio.cash_usd,
    portfolio.daily_pnl_pct,
    portfolio.risk_regime,
    debateOutputs,
    sectorBiases,
  );
  broadcastAnalysisEvent({
    id: `portfolio-metrics-${Date.now()}`,
    timestamp: new Date().toISOString(),
    agent: 'allocator',
    stage: 'allocate',
    title: `Portfolio: ${portfolioMetrics.position_count} pos, heat ${portfolioMetrics.portfolio_heat_pct.toFixed(1)}%/${portfolioMetrics.max_heat_pct}%, cash ${portfolioMetrics.cash_pct.toFixed(0)}%`,
    summary_simple: `${portfolioMetrics.position_count} positions, risque global ${portfolioMetrics.portfolio_heat_pct.toFixed(1)}%, cash ${portfolioMetrics.cash_pct.toFixed(0)}%, coût d'opportunité $${portfolioMetrics.opportunity_cost_usd.toFixed(0)}`,
    summary_expert: `Heat=${portfolioMetrics.portfolio_heat_pct}/${portfolioMetrics.max_heat_pct}% Cash=${portfolioMetrics.cash_pct}% Invested=${portfolioMetrics.invested_pct}% PnL=${portfolioMetrics.unrealized_pnl_pct.toFixed(2)}% Sectors=${JSON.stringify(portfolioMetrics.sector_concentration)} WeakPositions=${portfolioMetrics.weak_positions.length} OppCost=$${portfolioMetrics.opportunity_cost_usd.toFixed(0)}`,
    freshness_score: undefined,
  });

  // Step 9: Risk validation
  reporter.updateAgent('risk', { status: 'running' });
  const risk = new RiskAgent();
  const approvedOrders = await risk.run(
    preCheckedProposals,
    portfolioUsd,
    portfolio,
    collectorOutput.market,
    dailyLossLimitPct,
    collectorOutput.tickers,
    aiLog.rejections,
  );
  reporter.updateAgent('risk', { status: 'ok', lastRun: new Date().toISOString() });

  // Step 10: Track approved orders separately from executed
  aiLog.setApproved(approvedOrders);

  // Step 10b: Execute orders (mock broker)
  const execResults: Awaited<ReturnType<typeof executeOrder>>[] = [];
  const dryRun = process.env.MOCK_BROKER === 'false' || process.env.DRY_RUN === 'true';
  if (dryRun) {
    console.log(`[Orchestrator] [DRY_RUN] Orders skipped — ${approvedOrders.length} order(s) would have been sent: ${approvedOrders.map(o => `${o.ticker} ${o.action} $${o.size_usd.toFixed(0)}`).join(', ') || 'none'}`);
  } else {
    for (const order of approvedOrders) {
      try {
        const result = await executeOrder(order);
        execResults.push(result);
      } catch (err) {
        console.error(`[Orchestrator] Order execution failed for ${order.ticker}:`, err);
      }
    }
  }
  aiLog.setExecuted(execResults);

  // Step 11: Report + AgentPrediction logging
  reporter.updateAgent('reporter', { status: 'running' });
  const finalPortfolio = await getPortfolioState(portfolioUsd);

  // Update equity peak for drawdown-from-peak tracking
  if (finalPortfolio.total_usd > 0) {
    await updateEquityPeak(finalPortfolio.total_usd);
  }

  const analysisEvents = await reporter.finalize(
    cycleStart,
    debateOutputs,
    execResults,
    portfolioUsd,
    dailyLossLimitPct,
    finalPortfolio,
    collectorOutput.market,
    discoveryResult.tickers
  );
  reporter.updateAgent('reporter', { status: 'ok', lastRun: new Date().toISOString() });

  const duration = Date.now() - cycleStart;
  console.log(`[Orchestrator] === CYCLE COMPLETE in ${duration}ms ===`);

  await Promise.all([
    prisma.cycleLog.create({
      data: {
        payload: { debateOutputs, execResults, finalPortfolio, market: collectorOutput.market, analysis_events: analysisEvents } as any,
        ordersCount: execResults.length,
        alertsCount: 0,
        durationMs: duration,
      },
    }),
    aiLog.save(),
  ]);
}

export async function runPipeline(): Promise<void> {
  if (isRunning) {
    console.log('[Orchestrator] Pipeline already running, skipping cycle');
    return;
  }

  isRunning = true;
  const reporter = new ReporterAgent();

  try {
    await Promise.race([runPipelineInternal(reporter), cycleTimeout()]);
  } catch (err) {
    console.error('[Orchestrator] Cycle error:', err);
    reporter.updateAgent('reporter', { status: 'error', error: String(err) });

    const portfolioUsdRaw = await getCredential('portfolio_usd', 'PORTFOLIO_USD');
    const portfolioUsd = parseFloat(portfolioUsdRaw || '10000');
    const lossLimitRaw = await getCredential('daily_loss_limit_pct', 'DAILY_LOSS_LIMIT_PCT');
    const dailyLossLimitPct = parseFloat(lossLimitRaw || '3');
    await reporter.finalize(Date.now(), [], [], portfolioUsd, dailyLossLimitPct);
  } finally {
    isRunning = false;
  }
}
