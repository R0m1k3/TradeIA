import { cacheGet, cacheSet, TTL } from './cache';
import { getTickerSnapshots } from './yahoo';

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

/** Get daily change % for CAC 40, DAX, FTSE 100 via getTickerSnapshots (shared crumb + proven path) */
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

  try {
    const snapshots = await getTickerSnapshots(['^FCHI', '^GDAXI', '^FTSE']);
    for (const s of snapshots) {
      const pct = s.change_1d_pct !== null ? Math.round(s.change_1d_pct * 100) / 100 : 0;
      if (s.ticker === '^FCHI') result.cac40_change_pct = pct;
      else if (s.ticker === '^GDAXI') result.dax_change_pct = pct;
      else if (s.ticker === '^FTSE') result.ftse100_change_pct = pct;
    }
    console.log(`[EU Markets] CAC40 ${result.cac40_change_pct}% DAX ${result.dax_change_pct}% FTSE ${result.ftse100_change_pct}%`);
  } catch (err) {
    console.warn('[EU Markets] getEUIndexDirection failed:', (err as Error).message);
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