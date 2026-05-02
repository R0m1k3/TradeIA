import { FastifyPluginAsync } from 'fastify';
import { redis } from '../data/cache';
import { prisma } from '../lib/prisma';
import { getCredential } from '../config/credentials';

const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async () => {
    const checks = await Promise.allSettled([
      redis.ping(),
      prisma.$queryRaw`SELECT 1`,
      getCredential('polygon_key', 'POLYGON_KEY'),
      getCredential('finnhub_key', 'FINNHUB_KEY'),
      getCredential('alpha_vantage_key', 'ALPHA_VANTAGE_KEY'),
      getCredential('fred_api_key', 'FRED_API_KEY'),
    ]);

    const [redisCheck, dbCheck, polygonKey, finnhubKey, avKey, fredKey] = checks;

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        redis: redisCheck.status === 'fulfilled' ? 'ok' : 'error',
        database: dbCheck.status === 'fulfilled' ? 'ok' : 'error',
      },
      api_providers: {
        polygon: polygonKey.status === 'fulfilled' && polygonKey.value ? 'configured' : 'missing',
        finnhub: finnhubKey.status === 'fulfilled' && finnhubKey.value ? 'configured' : 'missing',
        alpha_vantage: avKey.status === 'fulfilled' && avKey.value ? 'configured' : 'missing',
        fred: fredKey.status === 'fulfilled' && fredKey.value ? 'configured' : 'missing (macro data désactivée)',
        yahoo_finance: 'always_available',
      },
      notes: {
        fred: 'Clé gratuite sur fred.stlouisfed.org — débloque données macro (taux Fed, courbe yield, CPI)',
        polygon: 'Starter $29/mois recommandé pour données temps réel fiables',
      },
    };
  });
};

export default healthRoutes;
