import { prisma } from '../lib/prisma';
import { getNasdaqStatus } from '../routes/market';

const NASDAQ_100 = [
  'AAPL', 'ABNB', 'ADBE', 'ADI', 'ADP', 'ADSK', 'AEP', 'AMGN', 'AMZN', 'ANSS',
  'ARM', 'ASML', 'AVGO', 'AXON', 'AZN', 'BIIB', 'BKNG', 'BKR', 'CDNS', 'CDW',
  'CEG', 'CHTR', 'CMCSA', 'COIN', 'COST', 'CPRT', 'CRWD', 'CTAS', 'CTSH', 'DASH',
  'DDOG', 'DLTR', 'DXCM', 'EA', 'EXC', 'FANG', 'FAST', 'FTNT', 'GE', 'GILD',
  'GOOGL', 'HON', 'IDXX', 'ILMN', 'INTC', 'INTU', 'ISRG', 'KDP', 'KHC', 'KLAC',
  'LRCX', 'LULU', 'MAR', 'MCHP', 'MDB', 'MDLZ', 'MELI', 'META', 'MNST', 'MRVL',
  'MSFT', 'MU', 'NFLX', 'NVDA', 'NXPI', 'ODFL', 'ON', 'ORCL', 'PANW', 'PAYX',
  'PCAR', 'PDD', 'PEP', 'PLTR', 'PYPL', 'QCOM', 'REGN', 'ROP', 'ROST', 'SBUX',
  'SNPS', 'TEAM', 'TMUS', 'TSLA', 'TTD', 'TTWO', 'TXN', 'VRTX', 'VRSK', 'VRSN',
  'WBD', 'WDAY', 'XEL', 'ZS',
];

const CRYPTO_TOP_20 = [
  'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE', 'ADA', 'AVAX', 'SHIB', 'DOT',
  'LINK', 'TRX', 'MATIC', 'BCH', 'LTC', 'NEAR', 'UNI', 'APT', 'INJ', 'RENDER',
];

function enabled(value: string | undefined, fallback = true): boolean {
  if (!value) return fallback;
  return !['false', '0', 'off', 'disabled'].includes(value.toLowerCase());
}

export class DiscoveryAgent {
  async run(): Promise<string[]> {
    const nasdaq = getNasdaqStatus();
    const cryptoConfig = await prisma.config.findUnique({ where: { key: 'crypto_work_enabled' } });
    const cryptoRaw = cryptoConfig?.value || process.env.CRYPTO_WORK_ENABLED;
    const cryptoEnabled = enabled(cryptoRaw, true);

    if (!nasdaq.isOpen) {
      if (!cryptoEnabled) {
        console.log('[Discovery] Market closed and crypto work paused - no active scan');
        return [];
      }

      const shuffled = [...CRYPTO_TOP_20].sort(() => 0.5 - Math.random());
      console.log(`[Discovery] Market closed - crypto-only mode: ${shuffled.length} tickers`);
      return shuffled;
    }

    const allTickers = cryptoEnabled ? [...NASDAQ_100, ...CRYPTO_TOP_20] : NASDAQ_100;
    const shuffled = allTickers.sort(() => 0.5 - Math.random());
    console.log(`[Discovery] Market open - normal scan: ${shuffled.length} tickers (${cryptoEnabled ? 'stocks + crypto' : 'stocks only'})`);
    return shuffled;
  }
}
