import type { PrismaClient } from '@prisma/client';

let _prisma: PrismaClient | null = null;
const cache = new Map<string, string>();

export function initCredentials(prisma: PrismaClient) {
  _prisma = prisma;
}

function prisma(): PrismaClient {
  if (!_prisma) throw new Error('Credentials not initialized — call initCredentials(prisma) at startup');
  return _prisma;
}

export async function getCredential(configKey: string, envFallback?: string): Promise<string> {
  if (cache.has(configKey)) return cache.get(configKey)!;

  const row = await prisma().config.findUnique({ where: { key: configKey } });
  if (row) {
    cache.set(configKey, row.value);
    return row.value;
  }

  if (envFallback && process.env[envFallback]) {
    const val = process.env[envFallback]!;
    cache.set(configKey, val);
    return val;
  }

  cache.set(configKey, '');
  return '';
}

export async function warmCredentialsCache(): Promise<void> {
  const rows = await prisma().config.findMany();
  for (const row of rows) {
    cache.set(row.key, row.value);
  }
}

export function invalidateCredential(configKey: string): void {
  cache.delete(configKey);
}
