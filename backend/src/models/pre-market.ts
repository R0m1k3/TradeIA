import { prisma } from '../lib/prisma';

export interface PreMarketPrepInput {
  date: string; // YYYY-MM-DD
  ticker: string;
  closePrev: number;
  vixPrev?: number | null;
  macroSummary?: string | null;
  setupSignal: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  reasoning: string;
}

export async function savePrep(input: PreMarketPrepInput): Promise<void> {
  await prisma.preMarketPrep.upsert({
    where: {
      id: (await prisma.preMarketPrep.findFirst({
        where: { date: input.date, ticker: input.ticker },
        select: { id: true },
      }))?.id ?? '',
    },
    update: {
      closePrev: input.closePrev,
      vixPrev: input.vixPrev ?? null,
      macroSummary: input.macroSummary ?? null,
      setupSignal: input.setupSignal,
      confidence: input.confidence,
      reasoning: input.reasoning,
    },
    create: {
      date: input.date,
      ticker: input.ticker,
      closePrev: input.closePrev,
      vixPrev: input.vixPrev ?? null,
      macroSummary: input.macroSummary ?? null,
      setupSignal: input.setupSignal,
      confidence: input.confidence,
      reasoning: input.reasoning,
    },
  });
}

export async function getPrepForDate(date: string) {
  return prisma.preMarketPrep.findMany({
    where: { date },
    orderBy: { confidence: 'desc' },
  });
}

export async function getPrepForTicker(ticker: string, limit: number = 30) {
  return prisma.preMarketPrep.findMany({
    where: { ticker },
    orderBy: { date: 'desc' },
    take: limit,
  });
}

export async function markExecuted(id: string): Promise<void> {
  await prisma.preMarketPrep.update({
    where: { id },
    data: { executedAtOpen: true },
  });
}
