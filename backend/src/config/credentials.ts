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
  if (cache.has(configKey) && cache.get(configKey) !== '') return cache.get(configKey)!;

  const row = await prisma().config.findUnique({ where: { key: configKey } });
  if (row && row.value.trim() !== '') {
    console.log(`[Credentials] Found ${configKey} in database`);
    cache.set(configKey, row.value.trim());
    return row.value.trim();
  }

  if (envFallback && process.env[envFallback] && process.env[envFallback]?.trim() !== '') {
    const val = process.env[envFallback]!.trim();
    console.log(`[Credentials] Using ${configKey} from environment (${envFallback})`);
    cache.set(configKey, val);
    return val;
  }

  console.warn(`[Credentials] No value found for ${configKey} (DB or ENV)`);
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
