import { getNasdaqStatus } from '../routes/market';
import { isEuropeanMarketOpen } from '../data/european-markets';
import { getTickerSnapshots } from '../data/yahoo';
import type { AllocationBudget } from './balance-controller';

export type MarketSegment = 'nasdaq' | 'cac40' | 'dax40' | 'ftse100' | 'eu_other';

export interface DiscoveryResult {
  tickers: string[];
  segments: Record<string, MarketSegment>;
}

export const NASDAQ_100: string[] = [
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

export const DAX_40: string[] = [
  'SAP:XETR', 'SIE:XETR', 'ALV:XETR', 'DTE:XETR', 'BAS:XETR', 'BMW:XETR', 'MBG:XETR',
  'BAYN:XETR', 'ADS:XETR', 'DBK:XETR', 'BEI:XETR', 'CBK:XETR', 'CON:XETR', 'DB1:XETR',
  'DHL:XETR', 'EON:XETR', 'FME:XETR', 'FRE:XETR', 'HEID:XETR', 'HEN3:XETR', 'IFX:XETR',
  'MRK:XETR', 'MUV2:XETR', 'PAH3:XETR', 'P911:XETR', 'PUM:XETR', 'QIA:XETR', 'RHM:XETR',
  'RWE:XETR', 'SRT3:XETR', 'SHL:XETR', 'SY1:XETR', 'VOW3:XETR', 'VNA:XETR', 'ZAL:XETR',
  'ENR:XETR', 'MTX:XETR', 'BNR:XETR', 'BOSS:XETR', 'DTG:XETR',
];

export const CAC_40: string[] = [
  'MC:XPAR', 'TTE:XPAR', 'SAN:XPAR', 'OR:XPAR', 'AIR:XPAR', 'BNP:XPAR', 'AXA:XPAR',
  'KER:XPAR', 'RMS:XPAR', 'SU:XPAR', 'ACA:XPAR', 'AI:XPAR', 'ALO:XPAR', 'BN:XPAR',
  'CAP:XPAR', 'CA:XPAR', 'DG:XPAR', 'EL:XPAR', 'EN:XPAR', 'GLE:XPAR', 'HO:XPAR',
  'ML:XPAR', 'ORA:XPAR', 'PUB:XPAR', 'RI:XPAR', 'RNO:XPAR', 'SAF:XPAR', 'SGO:XPAR',
  'STLA:XPAR', 'STM:XPAR', 'URW:XPAR', 'VIE:XPAR', 'VIV:XPAR', 'WLN:XPAR', 'ERF:XPAR',
  'SG:XPAR', 'NK:XPAR', 'FP:XPAR', 'CS:XPAR', 'VK:XPAR',
];

export const FTSE_100: string[] = [
  'AZN:LSE', 'SHEL:LSE', 'BP:LSE', 'HSBA:LSE', 'ULVR:LSE', 'GSK:LSE', 'RIO:LSE',
  'LLOY:LSE', 'BARC:LSE', 'VOD:LSE', 'GLEN:LSE', 'AAL:LSE', 'PRU:LSE', 'NG:LSE',
  'NWG:LSE', 'LSEG:LSE', 'REL:LSE', 'DGE:LSE', 'AV:LSE', 'BA:LSE', 'EXPN:LSE',
  'FERG:LSE', 'HLN:LSE', 'IAG:LSE', 'IHG:LSE', 'IMB:LSE', 'JD:LSE', 'JMAT:LSE',
  'KGF:LSE', 'MNG:LSE', 'MKS:LSE', 'OCDO:LSE', 'PSON:LSE', 'RKT:LSE', 'RS1:LSE',
  'SBRY:LSE', 'SGE:LSE', 'SGRO:LSE', 'SMT:LSE', 'SN:LSE', 'STAN:LSE', 'SVT:LSE',
  'TSCO:LSE', 'UU:LSE', 'WPP:LSE', 'BATS:LSE', 'CPG:LSE', 'NXT:LSE', 'RR:LSE',
  'SSE:LSE', 'LGEN:LSE', 'WTB:LSE', 'CNA:LSE', 'IMI:LSE', 'INF:LSE', 'MNDI:LSE',
  'PSN:LSE', 'WEIR:LSE', 'MRO:LSE', 'SDR:LSE',
];

export const EU_OTHER: string[] = [
  'HEIA:XAMS', 'UNA:XAMS', 'WKL:XAMS', 'PHIA:XAMS',
  'NESN:XSWX', 'ROG:XSWX', 'NOVN:XSWX', 'ZURN:XSWX', 'ABBN:XSWX', 'UHR:XSWX',
  'NOVOB:XCSE', 'RAND:XAMS',
];

const SEGMENT_LISTS: Record<MarketSegment, string[]> = {
  nasdaq: NASDAQ_100,
  dax40: DAX_40,
  cac40: CAC_40,
  ftse100: FTSE_100,
  eu_other: EU_OTHER,
};

/** Build a segments map: ticker → segment */
function buildSegmentsMap(tickers: string[], ...segmentPairs: Array<[string[], MarketSegment]>): Record<string, MarketSegment> {
  const map: Record<string, MarketSegment> = {};
  for (const [list, seg] of segmentPairs) {
    for (const t of list) {
      if (tickers.includes(t)) {
        map[t] = seg;
      }
    }
  }
  return map;
}

export class DiscoveryAgent {
  /**
   * Momentum-aware selection: fetches 1d snapshot, scores by change_pct,
   * deprioritizes earnings spikes (>15%), returns top N.
   */
  async scoreAndSelect(
    tickers: string[],
    segment: MarketSegment,
    n: number,
  ): Promise<string[]> {
    const segmentList = SEGMENT_LISTS[segment];
    const filtered = tickers.filter((t) => segmentList.includes(t));
    if (filtered.length <= n) return filtered;

    try {
      const snapshots = await getTickerSnapshots(filtered);
      const snapMap = new Map(snapshots.map((s) => [s.ticker, s]));

      const scored = filtered.map((ticker) => {
        const snap = snapMap.get(ticker);
        if (!snap || snap.price === null) return { ticker, score: -999 }; // no data → deprioritize
        const pct = snap.change_1d_pct ?? 0;
        if (Math.abs(pct) > 15) return { ticker, score: -10 }; // earnings spike → too risky
        const volBonus = snap.volume !== null && snap.volume > 500_000 ? 1.5 : 0;
        return { ticker, score: pct + volBonus };
      });

      scored.sort((a, b) => b.score - a.score);
      const selected = scored.slice(0, n).map((s) => s.ticker);
      console.log(`[Discovery] Segment ${segment}: top ${selected.length}/${filtered.length} by momentum`);
      return selected;
    } catch (err) {
      console.warn(`[Discovery] scoreAndSelect fallback (${segment}):`, (err as Error).message);
      return filtered.slice(0, n);
    }
  }

  async run(budget?: AllocationBudget): Promise<DiscoveryResult> {
    const nasdaq = getNasdaqStatus();
    const euOpen = isEuropeanMarketOpen(new Date());

    if (!nasdaq.isOpen && !euOpen) {
      console.log('[Discovery] All markets closed - no active scan');
      return { tickers: [], segments: {} };
    }

    let selectedTickers: string[];
    const allPairs: Array<[string[], MarketSegment]> = [
      [NASDAQ_100, 'nasdaq'],
      [DAX_40, 'dax40'],
      [CAC_40, 'cac40'],
      [FTSE_100, 'ftse100'],
      [EU_OTHER, 'eu_other'],
    ];

    if (!nasdaq.isOpen && euOpen) {
      // Only EU open: EU tickers + top 20 US
      const euTickers = [...DAX_40, ...CAC_40, ...FTSE_100, ...EU_OTHER];
      const usTop20 = [...NASDAQ_100].sort(() => 0.5 - Math.random()).slice(0, 20);
      selectedTickers = [...euTickers, ...usTop20];
      console.log(`[Discovery] EU market open only - ${selectedTickers.length} tickers`);
    } else if (nasdaq.isOpen && !euOpen) {
      // Only US open: US tickers + all EU (they may have after-hours data)
      const euTickers = [...DAX_40, ...CAC_40, ...FTSE_100, ...EU_OTHER];
      selectedTickers = [...NASDAQ_100, ...euTickers];
      console.log(`[Discovery] US market open only - ${selectedTickers.length} tickers`);
    } else {
      // Both open
      selectedTickers = [...NASDAQ_100, ...DAX_40, ...CAC_40, ...FTSE_100, ...EU_OTHER];
      console.log(`[Discovery] All markets open - ${selectedTickers.length} tickers`);
    }

    // Build segments map
    const segmentsMap = buildSegmentsMap(selectedTickers, ...allPairs);

    // If budget provided, select candidates_to_analyze per segment (momentum-sorted)
    if (budget) {
      const budgetedTickers: string[] = [];
      for (const [seg, alloc] of Object.entries(budget.segments) as Array<[MarketSegment, { slots: number; candidates_to_analyze: number }]>) {
        const candidates = await this.scoreAndSelect(selectedTickers, seg, alloc.candidates_to_analyze);
        budgetedTickers.push(...candidates);
      }
      const finalTickers = [...new Set(budgetedTickers)];
      console.log(`[Discovery] Budget-filtered to ${finalTickers.length} candidates (momentum-sorted)`);
      return { tickers: finalTickers, segments: segmentsMap };
    }

    return { tickers: selectedTickers, segments: segmentsMap };
  }
}
