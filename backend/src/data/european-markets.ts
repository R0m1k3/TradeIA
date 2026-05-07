import axios from 'axios';
import { getCredential } from '../config/credentials';
import { cacheGet, cacheSet, TTL } from './cache';

export interface EUIndexData {
  cac40_change_pct: number;
  dax_change_pct: number;
  ftse100_change_pct: number;
  eu_market_open: boolean;
}

export interface EUMarketStatus {
  euronext_open: boolean;
  xetra_open: boolean;
  lse_open: boolean;
  anyOpen: boolean;
  nextOpen: string;
}

const TWELVE_DATA = 'https://api.twelvedata.com';

// European index symbols for Twelve Data / Yahoo
const EU_INDICES = {
  cac40: { twelve: '^FCHI', yahoo: '^FCHI' },
  dax: { twelve: '^GDAXI', yahoo: '^GDAXI' },
  ftse100: { twelve: '^FTSE', yahoo: '^FTSE' },
};

async function getTwelveDataKey(): Promise<string | null> {
  return getCredential('twelve_data_key', 'TWELVE_DATA_KEY');
}

/** Get daily change % for CAC 40, DAX, FTSE 100 */
export async function getEUIndexDirection(): Promise<EUIndexData> {
  const cacheKey = 'eu:index_direction';
  const cached = await cacheGet<EUIndexData>(cacheKey);
  if (cached) return cached;

  const result: EUIndexData = {
    cac40_change_pct: 0,
    dax_change_pct: 0,
    ftse100_change_pct: 0,
    eu_market_open: isEuropeanMarketOpen(new Date()),
  };

  // Try Twelve Data first (covers all three indices with one API key)
  const apikey = await getTwelveDataKey();
  if (apikey) {
    try {
      const symbols = Object.values(EU_INDICES).map(s => s.twelve).join(',');
      const response = await axios.get(`${TWELVE_DATA}/quote`, {
        params: { symbol: symbols, apikey },
        timeout: 10_000,
        validateStatus: () => true,
      });

      if (response.status === 200) {
        const data = response.data;
        // Twelve Data returns either an object (single) or map of symbols
        const extract = (sym: string): number => {
          const entry = data[sym] || data;
          const pct = parseFloat(entry?.percent_change || entry?.change_percent || '0');
          return isNaN(pct) ? 0 : pct;
        };
        result.cac40_change_pct = Math.round(extract(EU_INDICES.cac40.twelve) * 100) / 100;
        result.dax_change_pct = Math.round(extract(EU_INDICES.dax.twelve) * 100) / 100;
        result.ftse100_change_pct = Math.round(extract(EU_INDICES.ftse100.twelve) * 100) / 100;

        await cacheSet(cacheKey, result, TTL.MARKET_CONTEXT);
        return result;
      }
    } catch (err) {
      console.warn('[EU Markets] Twelve Data failed:', (err as Error).message);
    }
  }

  // Fallback: Yahoo Finance for each index
  const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
  const YAHOO_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };

  // Get Yahoo crumb
  let crumb: string | null = null;
  try {
    const crumbRes = await axios.get('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: YAHOO_HEADERS,
      timeout: 10_000,
    });
    if (typeof crumbRes.data === 'string' && crumbRes.data.length > 5) {
      crumb = crumbRes.data;
    }
  } catch {
    // Continue without crumb
  }

  for (const [key, sym] of Object.entries(EU_INDICES)) {
    try {
      const params: Record<string, string> = { interval: '1d', range: '5d' };
      if (crumb) params.crumb = crumb;
      const response = await axios.get(`${YAHOO_BASE}/${sym.yahoo}`, {
        params,
        headers: YAHOO_HEADERS,
        timeout: 10_000,
        validateStatus: () => true,
      });

      if (response.status === 200) {
        const closes = response.data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
        if (closes && closes.length >= 2) {
          const validCloses = closes.filter((c: number | null) => c !== null);
          if (validCloses.length >= 2) {
            const today = validCloses[validCloses.length - 1];
            const yesterday = validCloses[validCloses.length - 2];
            const pct = ((today - yesterday) / yesterday) * 100;
            const rounded = Math.round(pct * 100) / 100;
            if (key === 'cac40') result.cac40_change_pct = rounded;
            if (key === 'dax') result.dax_change_pct = rounded;
            if (key === 'ftse100') result.ftse100_change_pct = rounded;
          }
        }
      }
    } catch {
      // Continue with other indices
    }
  }

  await cacheSet(cacheKey, result, TTL.MARKET_CONTEXT);
  return result;
}

/** Check if European markets are currently open */
export function isEuropeanMarketOpen(now: Date = new Date()): boolean {
  const status = getEUMarketStatus(now);
  return status.anyOpen;
}

/** Get detailed European market status */
export function getEUMarketStatus(now: Date = new Date()): EUMarketStatus {
  // Convert to CET/CEST
  const cetOffset = getCETOffsetMs(now);
  const cetMs = now.getTime() + cetOffset;
  const cetDate = new Date(cetMs);

  const day = cetDate.getUTCDay();
  const h = cetDate.getUTCHours();
  const m = cetDate.getUTCMinutes();
  const time = h * 60 + m;

  const isWeekday = day >= 1 && day <= 5;

  // Euronext Paris/Amsterdam/Brussels: 9:00-17:30 CET
  const euronextOpen = isWeekday && time >= 540 && time < 1050;
  // Xetra (Frankfurt): 9:00-17:30 CET
  const xetraOpen = isWeekday && time >= 540 && time < 1050;

  // LSE: 8:00-16:30 GMT = 9:00-17:30 CET (same as Euronext in CET terms)
  // But LSE uses GMT, so we need to adjust for BST/GMT
  const gmtOffset = isBritishSummer(now) ? -3600000 : 0; // BST = UTC+1, GMT = UTC
  const gmtMs = now.getTime() + gmtOffset;
  const gmtDate = new Date(gmtMs);
  const gmtDay = gmtDate.getUTCDay();
  const gmtTime = gmtDate.getUTCHours() * 60 + gmtDate.getUTCMinutes();
  const lseOpen = gmtDay >= 1 && gmtDay <= 5 && gmtTime >= 480 && gmtTime < 990; // 8:00-16:30 GMT

  const anyOpen = euronextOpen || xetraOpen || lseOpen;

  let nextOpen: string;
  if (anyOpen) {
    nextOpen = '';
  } else if (!isWeekday) {
    nextOpen = 'Ouvre lundi';
  } else if (time < 540) {
    const mins = 540 - time;
    nextOpen = mins >= 60 ? `Ouvre dans ${Math.floor(mins / 60)}h${mins % 60 > 0 ? ` ${mins % 60}min` : ''}` : `Ouvre dans ${mins}min`;
  } else {
    nextOpen = 'Fermé — ouvre demain';
  }

  return {
    euronext_open: euronextOpen,
    xetra_open: xetraOpen,
    lse_open: lseOpen,
    anyOpen,
    nextOpen,
  };
}

export function getCETOffsetMs(date: Date): number {
  const year = date.getUTCFullYear();
  const marchDow = new Date(Date.UTC(year, 2, 1)).getUTCDay();
  const dstStart = Date.UTC(year, 2, 8 + ((7 - marchDow) % 7), 1); // Last Sunday of March 1am UTC
  const octDow = new Date(Date.UTC(year, 9, 1)).getUTCDay();
  const dstEnd = Date.UTC(year, 9, 1 + ((7 - octDow) % 7), 1); // Last Sunday of October 1am UTC
  const isDST = date.getTime() >= dstStart && date.getTime() < dstEnd;
  return isDST ? 2 * 3600000 : 1 * 3600000; // CET = UTC+1, CEST = UTC+2
}

function isBritishSummer(date: Date): boolean {
  const year = date.getUTCFullYear();
  const marchDow = new Date(Date.UTC(year, 2, 1)).getUTCDay();
  const bstStart = Date.UTC(year, 2, 8 + ((7 - marchDow) % 7), 1);
  const octDow = new Date(Date.UTC(year, 9, 1)).getUTCDay();
  const bstEnd = Date.UTC(year, 9, 1 + ((7 - octDow) % 7), 1);
  return date.getTime() >= bstStart && date.getTime() < bstEnd;
}