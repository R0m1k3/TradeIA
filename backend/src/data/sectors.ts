import { getYahooOHLCV } from './yahoo';
import { cacheGet, cacheSet, TTL } from './cache';

/** Mapping tickers → secteur (NASDAQ + EU) */
export const TICKER_SECTOR: Record<string, string> = {
  // === NASDAQ 100 ===
  AAPL: 'Tech', MSFT: 'Tech', NVDA: 'Tech', AVGO: 'Tech', ORCL: 'Tech',
  ADBE: 'Tech', CRM: 'Tech', INTC: 'Tech', AMD: 'Tech', QCOM: 'Tech',
  TXN: 'Tech', LRCX: 'Tech', KLAC: 'Tech', MRVL: 'Tech', SNPS: 'Tech',
  CDNS: 'Tech', ARM: 'Tech', ASML: 'Tech', MCHP: 'Tech', NXPI: 'Tech', ON: 'Tech',
  GOOGL: 'Comms', META: 'Comms', NFLX: 'Comms', CMCSA: 'Comms', CHTR: 'Comms',
  TMUS: 'Comms', WBD: 'Comms',
  AMZN: 'ConsDisc', TSLA: 'ConsDisc', BKNG: 'ConsDisc', ABNB: 'ConsDisc',
  SBUX: 'ConsDisc', MAR: 'ConsDisc', LULU: 'ConsDisc', ROST: 'ConsDisc',
  PYPL: 'Fintech', COIN: 'Fintech',
  ISRG: 'Health', GILD: 'Health', VRTX: 'Health', REGN: 'Health',
  MRNA: 'Health', ILMN: 'Health', BIIB: 'Health', MDLZ: 'Health', DXCM: 'Health', IDXX: 'Health',
  ADP: 'Enterprise', FTNT: 'Cyber', ZS: 'Cyber', DDOG: 'Cyber',
  NET: 'Cyber', CRWD: 'Cyber', PANW: 'Cyber',
  PLTR: 'AI', MDB: 'Tech', WDAY: 'Enterprise', TEAM: 'Enterprise', INTU: 'Enterprise',
  ANSS: 'Tech', ADSK: 'Tech', DASH: 'Enterprise', TTD: 'Tech',
  MNST: 'ConsStap', PEP: 'ConsStap', COST: 'ConsStap', KHC: 'ConsStap', KDP: 'ConsStap',
  GE: 'Industrial', HON: 'Industrial', VRSK: 'Industrial', FAST: 'Industrial',
  ODFL: 'Industrial', PCAR: 'Industrial', PAYX: 'Enterprise', CTAS: 'Industrial',
  AEP: 'Energy', XEL: 'Energy', CEG: 'Energy', EXC: 'Energy',
  BKR: 'Energy', FANG: 'Energy',
  AMGN: 'Health', AZN: 'Health',
  MELI: 'ConsDisc', PDD: 'ConsDisc',
  CPRT: 'Industrial', ROP: 'Industrial',
  VRSN: 'Tech', EA: 'ConsDisc', TTWO: 'ConsDisc',
  // === CAC 40 (:XPAR) ===
  'MC:XPAR': 'Luxury', 'KER:XPAR': 'Luxury', 'RMS:XPAR': 'Luxury', 'EL:XPAR': 'Luxury',
  'OR:XPAR': 'ConsStap', 'BN:XPAR': 'ConsStap', 'PUB:XPAR': 'Comms',
  'TTE:XPAR': 'Energy',
  'SAN:XPAR': 'Health',
  'AIR:XPAR': 'Industrial', 'SU:XPAR': 'Industrial', 'SAF:XPAR': 'Industrial',
  'SGO:XPAR': 'Industrial', 'ALO:XPAR': 'Industrial', 'RNO:XPAR': 'Auto',
  'STLA:XPAR': 'Auto',
  'BNP:XPAR': 'Finance', 'AXA:XPAR': 'Finance', 'ACA:XPAR': 'Finance',
  'GLE:XPAR': 'Finance', 'CS:XPAR': 'Finance',
  'STM:XPAR': 'Tech', 'CAP:XPAR': 'Tech',
  'AI:XPAR': 'Materials', 'BAS:XPAR': 'Materials',
  'ORA:XPAR': 'Comms', 'VIV:XPAR': 'Comms',
  'DG:XPAR': 'Industrial', 'EN:XPAR': 'Industrial', 'HO:XPAR': 'Industrial',
  'ML:XPAR': 'Industrial', 'VIE:XPAR': 'Industrial', 'WLN:XPAR': 'Industrial',
  'ERF:XPAR': 'ConsDisc', 'NK:XPAR': 'Industrial', 'VK:XPAR': 'Finance',
  'RI:XPAR': 'ConsStap', 'CA:XPAR': 'Finance', 'URW:XPAR': 'Finance',
  // === DAX 40 (:XETR) ===
  'SAP:XETR': 'Tech', 'IFX:XETR': 'Tech', 'SY1:XETR': 'Tech',
  'SIE:XETR': 'Industrial', 'DHL:XETR': 'Industrial', 'RHM:XETR': 'Industrial',
  'CON:XETR': 'Auto', 'BMW:XETR': 'Auto', 'MBG:XETR': 'Auto',
  'VOW3:XETR': 'Auto', 'PAH3:XETR': 'Auto', 'P911:XETR': 'Auto',
  'DTG:XETR': 'Auto', 'PUM:XETR': 'ConsDisc', 'ADS:XETR': 'ConsDisc',
  'BOSS:XETR': 'ConsDisc', 'ZAL:XETR': 'ConsDisc',
  'ALV:XETR': 'Finance', 'DBK:XETR': 'Finance', 'CBK:XETR': 'Finance',
  'MUV2:XETR': 'Finance', 'DB1:XETR': 'Finance', 'QIA:XETR': 'Finance',
  'BAYN:XETR': 'Health', 'MRK:XETR': 'Health', 'FME:XETR': 'Health',
  'FRE:XETR': 'Health', 'SHL:XETR': 'Health',
  'EOAN:XETR': 'Energy', 'RWE:XETR': 'Energy', 'ENR:XETR': 'Energy',
  'BAS:XETR': 'Materials', 'HEID:XETR': 'Materials', 'SRT3:XETR': 'Materials',
  'HEN3:XETR': 'ConsStap', 'BEI:XETR': 'ConsStap',
  'DTE:XETR': 'Comms',
  'VNA:XETR': 'Finance', 'MTX:XETR': 'Materials', 'BNR:XETR': 'Industrial',
  // === FTSE 100 (:LSE) ===
  'AZN:LSE': 'Health', 'GSK:LSE': 'Health', 'HLN:LSE': 'Health', 'SN:LSE': 'Health',
  'SHEL:LSE': 'Energy', 'BP:LSE': 'Energy', 'RIO:LSE': 'Materials',
  'AAL:LSE': 'Materials', 'GLEN:LSE': 'Materials', 'JMAT:LSE': 'Materials',
  'MRO:LSE': 'Energy',
  'HSBA:LSE': 'Finance', 'BARC:LSE': 'Finance', 'LLOY:LSE': 'Finance',
  'NWG:LSE': 'Finance', 'STAN:LSE': 'Finance', 'LSEG:LSE': 'Finance',
  'AV:LSE': 'Finance', 'LGEN:LSE': 'Finance', 'PRU:LSE': 'Finance',
  'MNG:LSE': 'Finance', 'SDR:LSE': 'Finance',
  'ULVR:LSE': 'ConsStap', 'DGE:LSE': 'ConsStap', 'TSCO:LSE': 'ConsStap',
  'SBRY:LSE': 'ConsStap', 'CPG:LSE': 'ConsStap', 'MKS:LSE': 'ConsDisc',
  'BATS:LSE': 'ConsStap', 'IMB:LSE': 'ConsStap',
  'REL:LSE': 'Comms', 'WPP:LSE': 'Comms', 'PSON:LSE': 'Comms', 'VOD:LSE': 'Comms',
  'BA:LSE': 'Industrial', 'RR:LSE': 'Industrial', 'EXPN:LSE': 'Industrial',
  'FERG:LSE': 'Industrial', 'IMI:LSE': 'Industrial', 'WEIR:LSE': 'Industrial',
  'RS1:LSE': 'Industrial', 'PSN:LSE': 'Industrial', 'INF:LSE': 'Industrial',
  'IHG:LSE': 'ConsDisc', 'IAG:LSE': 'Industrial', 'JD:LSE': 'ConsDisc',
  'KGF:LSE': 'ConsDisc', 'NXT:LSE': 'ConsDisc', 'WTB:LSE': 'ConsDisc',
  'SGE:LSE': 'Tech', 'OCDO:LSE': 'Tech',
  'NG:LSE': 'Energy', 'SSE:LSE': 'Energy', 'UU:LSE': 'Energy',
  'SVT:LSE': 'Energy', 'CNA:LSE': 'Energy',
  'SGRO:LSE': 'Finance', 'SMT:LSE': 'Finance', 'RKT:LSE': 'ConsStap',
  'MNDI:LSE': 'Materials',
  // === EU Other ===
  'HEIA:XAMS': 'ConsStap', 'UNA:XAMS': 'ConsStap', 'RAND:XAMS': 'Finance',
  'WKL:XAMS': 'Industrial', 'PHIA:XAMS': 'Health',
  'NESN:XSWX': 'ConsStap', 'ROG:XSWX': 'Health', 'NOVN:XSWX': 'Health',
  'ZURN:XSWX': 'Finance', 'ABBN:XSWX': 'Industrial', 'UHR:XSWX': 'Luxury',
  'NOVOB:XCSE': 'Health',
};

export function getTickerSector(ticker: string): string {
  // Try exact match first, then strip exchange suffix for fallback
  if (TICKER_SECTOR[ticker]) return TICKER_SECTOR[ticker];
  const base = ticker.split(':')[0];
  return TICKER_SECTOR[base] || 'Autre';
}

/** Secteur ETF → direction marché */
const SECTOR_ETFS: Record<string, string> = {
  Tech: 'XLK',
  Health: 'XLV',
  Fintech: 'XLF',
  ConsDisc: 'XLY',
  ConsStap: 'XLP',
  Energy: 'XLE',
  Industrial: 'XLI',
  Comms: 'XLC',
};

export interface SectorBias {
  sector: string;
  etf: string;
  direction: 'bullish' | 'bearish' | 'neutral';
  change_pct: number;
}

export async function getSectorBiases(): Promise<Record<string, SectorBias>> {
  const cacheKey = 'sectors:biases';
  const cached = await cacheGet<Record<string, SectorBias>>(cacheKey);
  if (cached) return cached;

  const biases: Record<string, SectorBias> = {};

  await Promise.all(
    Object.entries(SECTOR_ETFS).map(async ([sector, etf]) => {
      try {
        const bars = await getYahooOHLCV(etf, '1d', '5d');
        if (bars.length >= 2) {
          const today = bars[bars.length - 1].close;
          const yesterday = bars[bars.length - 2].close;
          const change = ((today - yesterday) / yesterday) * 100;
          biases[sector] = {
            sector,
            etf,
            direction: change > 0.5 ? 'bullish' : change < -0.5 ? 'bearish' : 'neutral',
            change_pct: Math.round(change * 100) / 100,
          };
        } else {
          biases[sector] = { sector, etf, direction: 'neutral', change_pct: 0 };
        }
      } catch {
        biases[sector] = { sector, etf, direction: 'neutral', change_pct: 0 };
      }
    })
  );

  await cacheSet(cacheKey, biases, TTL.SECTOR);
  return biases;
}

/** Compter positions ouvertes par secteur */
export function countPositionsBySector(
  positions: { ticker: string }[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of positions) {
    const sector = getTickerSector(p.ticker);
    counts[sector] = (counts[sector] || 0) + 1;
  }
  return counts;
}
