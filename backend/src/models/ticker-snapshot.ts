import { prisma } from '../lib/prisma';
import type { OHLCVBar } from '../data/indicators';

export async function saveSnapshots(ticker: string, interval: string, bars: OHLCVBar[], source: string = 'yahoo'): Promise<void> {
  if (bars.length === 0) return;
  // Upsert only the latest bar to avoid duplicates
  const latest = bars[bars.length - 1];
  const time = new Date(latest.time);

  await prisma.tickerSnapshot.upsert({
    where: {
      // Prisma doesn't support composite unique in upsert without explicit @unique
      // Using create + update fallback via ticker+time query
      id: (await prisma.tickerSnapshot.findFirst({
        where: { ticker, interval, time },
        select: { id: true },
      }))?.id ?? '',
    },
    update: {
      open: latest.open,
      high: latest.high,
      low: latest.low,
      close: latest.close,
      volume: latest.volume,
      source,
    },
    create: {
      ticker,
      interval,
      time,
      open: latest.open,
      high: latest.high,
      low: latest.low,
      close: latest.close,
      volume: latest.volume,
      source,
    },
  });
}

export async function getHistory(
  ticker: string,
  interval: string,
  from: Date,
  to: Date,
): Promise<{ time: Date; open: number; high: number; low: number; close: number; volume: number | null }[]> {
  const rows = await prisma.tickerSnapshot.findMany({
    where: { ticker, interval, time: { gte: from, lte: to } },
    orderBy: { time: 'asc' },
    select: { time: true, open: true, high: true, low: true, close: true, volume: true },
  });
  return rows;
}
