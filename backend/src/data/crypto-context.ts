import axios from 'axios';
import { cacheGet, cacheSet, TTL } from './cache';

export interface CryptoContext {
  crypto_fear_greed: { value: number; label: string } | null;
  btc_dominance: number | null;
  btc_change_24h: number | null;
}

function fngLabel(value: number): string {
  if (value <= 25) return 'Peur extrême';
  if (value <= 45) return 'Peur';
  if (value <= 55) return 'Neutre';
  if (value <= 75) return 'Confiance';
  return 'Cupidité extrême';
}

export async function getCryptoContext(): Promise<CryptoContext> {
  const cached = await cacheGet<CryptoContext>('crypto:context');
  if (cached) return cached;

  const [fng, btcTicker, global] = await Promise.allSettled([
    axios.get('https://api.alternative.me/fng/?limit=1', { timeout: 8_000 }),
    axios.get('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT', { timeout: 8_000 }),
    axios.get('https://api.coingecko.com/api/v3/global', { timeout: 8_000 }),
  ]);

  let crypto_fear_greed: CryptoContext['crypto_fear_greed'] = null;
  if (fng.status === 'fulfilled') {
    const raw = fng.value.data?.data?.[0]?.value;
    const v = raw ? parseInt(raw) : 0;
    if (v > 0) crypto_fear_greed = { value: v, label: fngLabel(v) };
  }

  let btc_change_24h: number | null = null;
  if (btcTicker.status === 'fulfilled') {
    const pct = parseFloat(btcTicker.value.data?.priceChangePercent ?? '');
    if (!isNaN(pct)) btc_change_24h = pct;
  }

  let btc_dominance: number | null = null;
  if (global.status === 'fulfilled') {
    const dom = global.value.data?.data?.market_cap_percentage?.btc;
    if (typeof dom === 'number') btc_dominance = Math.round(dom * 10) / 10;
  }

  const result: CryptoContext = { crypto_fear_greed, btc_dominance, btc_change_24h };
  await cacheSet('crypto:context', result, TTL.FUNDAMENTALS);
  return result;
}
