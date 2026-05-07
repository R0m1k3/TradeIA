import { getNasdaqStatus } from '../routes/market';
import { isEuropeanMarketOpen } from '../data/european-markets';

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

const EU_BLUE_CHIPS = [
  'SAP:XETR', 'SIE:XETR', 'ALV:XETR', 'DTE:XETR', 'BAS:XETR',
  'SAN:XPAR', 'MC:XPAR', 'TTE:XPAR', 'AIR:XPAR', 'OR:XPAR',
  'BP:LSE', 'SHEL:LSE', 'AZN:LSE', 'HSBA:LSE', 'ULVR:LSE',
  'NOVO:XCTR', 'ASML', 'NESN:XSWX', 'ROG:XSWX', 'NOVN:XSWX',
];

export class DiscoveryAgent {
  async run(): Promise<string[]> {
    const nasdaq = getNasdaqStatus();
    const euOpen = isEuropeanMarketOpen(new Date());

    const usTickers = [...NASDAQ_100].sort(() => 0.5 - Math.random());
    const euTickers = [...EU_BLUE_CHIPS].sort(() => 0.5 - Math.random());

    if (!nasdaq.isOpen && !euOpen) {
      console.log('[Discovery] All markets closed - no active scan');
      return [];
    }

    // When only EU is open, prioritize EU tickers
    if (!nasdaq.isOpen && euOpen) {
      const tickers = [...euTickers, ...usTickers.slice(0, 10)];
      console.log(`[Discovery] EU market open only - ${tickers.length} tickers`);
      return tickers;
    }

    // When both open, scan all
    const tickers = [...usTickers, ...euTickers];
    console.log(`[Discovery] Markets open - ${tickers.length} tickers (US + EU)`);
    return tickers;
  }
}