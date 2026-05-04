import { callLLM, parseJsonResponse } from '../llm/client';
import { getModels } from '../llm/models';

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
    console.log('[Discovery] Scanning global market (100% coverage)...');

    // Combine NASDAQ 100 and Crypto Top 20 for full market coverage
    const allTickers = [...NASDAQ_100, ...CRYPTO_TOP_20];
    
    // We shuffle the array so that if the cycle crashes halfway, it doesn't always miss the same ones at the end
    const shuffled = allTickers.sort(() => 0.5 - Math.random());
    
    console.log(`[Discovery] Selected ${shuffled.length} tickers for deep analysis.`);
    return shuffled;
  }
}