import { prisma } from '../lib/prisma';

export interface TickerNoteInput {
  ticker: string;
  noteType: string; // 'setup' | 'catalyst' | 'technique' | 'risque' | 'bull' | 'bear' | 'premarket'
  content: string;
  confidence?: number;
  cycleId?: string;
  metadata?: Record<string, unknown>;
}

export async function saveNote(input: TickerNoteInput): Promise<void> {
  await prisma.tickerNote.create({
    data: {
      ticker: input.ticker,
      noteType: input.noteType,
      content: input.content,
      confidence: input.confidence ?? null,
      cycleId: input.cycleId ?? null,
      metadata: (input.metadata ?? null) as any,
    },
  });
}

export async function saveNotes(inputs: TickerNoteInput[]): Promise<void> {
  if (inputs.length === 0) return;
  await prisma.tickerNote.createMany({
    data: inputs.map((i) => ({
      ticker: i.ticker,
      noteType: i.noteType,
      content: i.content,
      confidence: i.confidence ?? null,
      cycleId: i.cycleId ?? null,
      metadata: (i.metadata ?? null) as any,
    })),
    skipDuplicates: false,
  });
}

export async function getNotes(
  ticker: string,
  types?: string[],
  limit: number = 50,
) {
  return prisma.tickerNote.findMany({
    where: {
      ticker,
      ...(types && types.length > 0 ? { noteType: { in: types } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
