import IORedis from 'ioredis';

const redis = new IORedis(process.env.REDIS_URL || 'redis://redis:6379');

redis.on('error', (err) => console.error('[Cache] Redis error:', err.message));

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const val = await redis.get(key);
    return val ? (JSON.parse(val) as T) : null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (err) {
    console.error('[Cache] Set error:', err);
  }
}

export async function cacheDel(key: string): Promise<void> {
  try {
    await redis.del(key);
  } catch {
    // ignore
  }
}

export const TTL = {
  PRICE: 60,
  OHLCV: 300,
  FUNDAMENTALS: 86400,
  NEWS: 1800,
  OPTIONS: 3600,
  MARKET_CONTEXT: 300,
} as const;

export { redis };
