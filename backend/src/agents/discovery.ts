import { getNasdaqStatus } from '../routes/market';

/** NASDAQ 100 fallback tickers (full list) */
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

/** Top 20 Crypto (Binance pairs) */
const CRYPTO_TOP_20 = [
  'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE', 'ADA', 'AVAX', 'SHIB', 'DOT',
  'LINK', 'TRX', 'MATIC', 'BCH', 'LTC', 'NEAR', 'UNI', 'APT', 'INJ', 'RENDER'
];

export class DiscoveryAgent {
  async run(): Promise<string[]> {
    const nasdaq = getNasdaqStatus();

    if (!nasdaq.isOpen) {
      // Market closed — crypto trades 24/7, stocks don't move after hours
      const shuffled = [...CRYPTO_TOP_20].sort(() => 0.5 - Math.random());
      console.log(`[Discovery] Market closed — crypto-only mode: ${shuffled.length} tickers`);
      return shuffled;
    }

    // Market open — full scan: NASDAQ 100 + crypto
    const allTickers = [...NASDAQ_100, ...CRYPTO_TOP_20];
    const shuffled = allTickers.sort(() => 0.5 - Math.random());
    console.log(`[Discovery] Market open — full scan: ${shuffled.length} tickers (stocks + crypto)`);
    return shuffled;
  }
}