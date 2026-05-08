import { prisma } from '../lib/prisma';

const MAX_LOGS = 10;

export interface AILogRejection {
  ticker: string;
  action: string;
  reason: string;
}

export interface AILogPayload {
  cycleStart: string;
  durationMs: number;
  market: {
    vix: number;
    fear_greed: number;
    nasdaq_direction: string;
    nasdaq_change_pct?: number;
    nasdaq_open: boolean;
    eu_open: boolean;
    regime?: string;
    sector_biases?: unknown;
    eu?: unknown;
  };
  budget: unknown;
  discovery: {
    tickers: string[];
    count: number;
    segments?: Record<string, string>;
  };
  analysis: unknown[];
  proposals_raw: unknown[];
  risk_filter: {
    accepted: string[];
    rejected: AILogRejection[];
  };
  executed: unknown[];
  portfolio_snapshot: {
    total_usd: number;
    cash_usd?: number;
    daily_pnl_pct: number;
    risk_regime: string;
    positions_count: number;
  };
}

export class AILogCollector {
  private payload: Partial<AILogPayload> = {};
  private cycleStart: number;
  readonly rejections: AILogRejection[] = [];

  constructor(cycleStartMs: number) {
    this.cycleStart = cycleStartMs;
    this.payload.cycleStart = new Date(cycleStartMs).toISOString();
    this.payload.risk_filter = { accepted: [], rejected: this.rejections };
  }

  setMarket(market: AILogPayload['market']): void {
    this.payload.market = market;
  }

  setBudget(budget: unknown): void {
    this.payload.budget = budget;
  }

  setDiscovery(tickers: string[], segments?: Record<string, string>): void {
    this.payload.discovery = { tickers, count: tickers.length, segments };
  }

  setAnalysis(outputs: unknown[]): void {
    this.payload.analysis = outputs;
  }

  setProposals(proposals: unknown[]): void {
    this.payload.proposals_raw = proposals;
  }

  setExecuted(orders: unknown[]): void {
    this.payload.executed = orders;
    const accepted = (orders as Array<{ ticker: string }>).map((o) => o.ticker);
    this.payload.risk_filter = { accepted, rejected: this.rejections };
  }

  setPortfolio(portfolio: AILogPayload['portfolio_snapshot']): void {
    this.payload.portfolio_snapshot = portfolio;
  }

  async save(): Promise<void> {
    const durationMs = Date.now() - this.cycleStart;
    this.payload.durationMs = durationMs;

    try {
      await pruneOldLogs();
      await prisma.aILog.create({
        data: {
          durationMs,
          tickersCount: this.payload.analysis?.length ?? 0,
          proposalsCount: this.payload.proposals_raw?.length ?? 0,
          executedCount: this.payload.executed?.length ?? 0,
          rejectionsCount: this.rejections.length,
          payload: this.payload as object,
        },
      });
    } catch (err) {
      console.error('[AILogger] Failed to save log:', (err as Error).message);
    }
  }
}

async function pruneOldLogs(): Promise<void> {
  try {
    const total = await prisma.aILog.count();
    if (total < MAX_LOGS) return;
    // Keep only MAX_LOGS most recent — delete oldest (total - MAX_LOGS + 1) to make room
    const toDelete = total - MAX_LOGS + 1;
    const oldest = await prisma.aILog.findMany({
      orderBy: { createdAt: 'asc' },
      take: toDelete,
      select: { id: true },
    });
    const ids = oldest.map((r) => r.id);
    const { count } = await prisma.aILog.deleteMany({ where: { id: { in: ids } } });
    if (count > 0) console.log(`[AILogger] Pruned ${count} old logs (max ${MAX_LOGS} kept)`);
  } catch (err) {
    console.error('[AILogger] Prune failed:', (err as Error).message);
  }
}

export interface AILogMeta {
  id: string;
  createdAt: string;
  durationMs: number;
  tickersCount: number;
  proposalsCount: number;
  executedCount: number;
  rejectionsCount: number;
}

export async function listAILogs(): Promise<AILogMeta[]> {
  const rows = await prisma.aILog.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      createdAt: true,
      durationMs: true,
      tickersCount: true,
      proposalsCount: true,
      executedCount: true,
      rejectionsCount: true,
    },
  });
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

export async function getAILogPayload(id: string): Promise<AILogPayload | null> {
  const row = await prisma.aILog.findUnique({ where: { id } });
  return row ? (row.payload as unknown as AILogPayload) : null;
}

export async function getAllAILogsPayloads(): Promise<Array<{ id: string; createdAt: string; payload: AILogPayload }>> {
  const rows = await prisma.aILog.findMany({ orderBy: { createdAt: 'desc' } });
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    payload: r.payload as unknown as AILogPayload,
  }));
}

export async function deleteAILog(id: string): Promise<boolean> {
  try {
    await prisma.aILog.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

export async function deleteAllAILogs(): Promise<number> {
  const { count } = await prisma.aILog.deleteMany({});
  return count;
}
