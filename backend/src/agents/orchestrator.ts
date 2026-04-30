import { CollectorAgent } from './collector';
import { AnalystAgent } from './analyst';
import { ResearcherAgent } from './researcher';
import { StrategistAgent } from './strategist';
import { RiskAgent } from './risk';
import { ReporterAgent } from './reporter';
import { executeOrder, getPortfolioState, markToMarket } from '../broker/mock';
import { prisma } from '../lib/prisma';

const WATCHLIST = (process.env.WATCHLIST || 'AAPL,MSFT,GOOGL,NVDA,TSLA').split(',').map((t) => t.trim());
const PORTFOLIO_USD = parseFloat(process.env.PORTFOLIO_USD || '10000');
const DAILY_LOSS_LIMIT_PCT = parseFloat(process.env.DAILY_LOSS_LIMIT_PCT || '3');

let isRunning = false;

export async function runPipeline(): Promise<void> {
  if (isRunning) {
    console.log('[Orchestrator] Pipeline already running, skipping cycle');
    return;
  }

  isRunning = true;
  const cycleStart = Date.now();
  console.log('[Orchestrator] === CYCLE START ===', new Date().toISOString());

  const reporter = new ReporterAgent();
  reporter.updateAgent('collector', { status: 'running' });

  try {
    // Step 1: Mark to market existing positions
    await markToMarket();

    // Step 2: Collect data
    const collector = new CollectorAgent();
    const collectorOutput = await collector.run(WATCHLIST);
    reporter.updateAgent('collector', {
      status: collectorOutput ? 'ok' : 'error',
      lastRun: new Date().toISOString(),
    });

    if (!collectorOutput) {
      console.error('[Orchestrator] Collector failed, aborting cycle');
      await reporter.finalize(cycleStart, [], [], PORTFOLIO_USD, DAILY_LOSS_LIMIT_PCT);
      return;
    }

    // Step 3: Technical analysis
    reporter.updateAgent('analyst', { status: 'running' });
    const analyst = new AnalystAgent();
    const analystOutputs = await analyst.run(collectorOutput);
    reporter.updateAgent('analyst', { status: 'ok', lastRun: new Date().toISOString() });

    // Step 4: Bull/Bear debate (parallel)
    reporter.updateAgent('bull', { status: 'running' });
    reporter.updateAgent('bear', { status: 'running' });
    const researcher = new ResearcherAgent();
    const debateOutputs = await researcher.run(analystOutputs, collectorOutput);
    reporter.updateAgent('bull', { status: 'ok', lastRun: new Date().toISOString() });
    reporter.updateAgent('bear', { status: 'ok', lastRun: new Date().toISOString() });

    // Step 5: Strategic decision
    reporter.updateAgent('strategist', { status: 'running' });
    const portfolio = await getPortfolioState(PORTFOLIO_USD);
    const heldTickers = portfolio.positions.map((p) => p.ticker);

    const strategist = new StrategistAgent();
    const orderProposals = await strategist.run(debateOutputs, portfolio, collectorOutput.market, heldTickers);
    reporter.updateAgent('strategist', { status: 'ok', lastRun: new Date().toISOString() });

    // Step 6: Risk validation
    reporter.updateAgent('risk', { status: 'running' });
    const risk = new RiskAgent();
    const approvedOrders = await risk.run(orderProposals, PORTFOLIO_USD, portfolio, collectorOutput.market, DAILY_LOSS_LIMIT_PCT);
    reporter.updateAgent('risk', { status: 'ok', lastRun: new Date().toISOString() });

    // Step 7: Execute orders
    const execResults = [];
    if (process.env.MOCK_BROKER !== 'false') {
      for (const order of approvedOrders) {
        try {
          const result = await executeOrder(order);
          execResults.push(result);
        } catch (err) {
          console.error(`[Orchestrator] Order execution failed for ${order.ticker}:`, err);
        }
      }
    }

    // Step 8: Report
    reporter.updateAgent('reporter', { status: 'running' });
    const finalPortfolio = await getPortfolioState(PORTFOLIO_USD);
    await reporter.finalize(cycleStart, debateOutputs, execResults, PORTFOLIO_USD, DAILY_LOSS_LIMIT_PCT, finalPortfolio, collectorOutput.market);
    reporter.updateAgent('reporter', { status: 'ok', lastRun: new Date().toISOString() });

    const duration = Date.now() - cycleStart;
    console.log(`[Orchestrator] === CYCLE COMPLETE in ${duration}ms ===`);

    // Persist cycle log
    await prisma.cycleLog.create({
      data: {
        payload: { debateOutputs, execResults, finalPortfolio } as any,
        ordersCount: execResults.length,
        alertsCount: 0,
        durationMs: duration,
      },
    });
  } catch (err) {
    console.error('[Orchestrator] Cycle error:', err);
    reporter.updateAgent('reporter', { status: 'error', error: String(err) });
    await reporter.finalize(cycleStart, [], [], PORTFOLIO_USD, DAILY_LOSS_LIMIT_PCT);
  } finally {
    isRunning = false;
  }
}
