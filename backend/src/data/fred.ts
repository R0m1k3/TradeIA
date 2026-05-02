import axios from 'axios';
import { cacheGet, cacheSet, TTL } from './cache';
import { getCredential } from '../config/credentials';

const BASE = 'https://api.stlouisfed.org/fred/series/observations';

export interface MacroData {
  fed_funds_rate: number | null;   // DFF — taux directeur Fed
  yield_curve: number | null;      // T10Y2Y — spread 10Y-2Y (négatif = inversion)
  cpi_yoy: number | null;          // CPIAUCSL variation annuelle estimée
  macro_regime: 'EXPANSIF' | 'NEUTRE' | 'RESTRICTIF';
  summary: string;
}

async function fetchSeries(seriesId: string, apiKey: string): Promise<number | null> {
  try {
    const response = await axios.get(BASE, {
      params: {
        series_id: seriesId,
        api_key: apiKey,
        file_type: 'json',
        sort_order: 'desc',
        limit: 2,
      },
      timeout: 10_000,
    });
    const observations = response.data?.observations;
    if (!Array.isArray(observations) || observations.length === 0) return null;
    const val = parseFloat(observations[0]?.value);
    return isNaN(val) ? null : val;
  } catch {
    return null;
  }
}

export async function getMacroData(): Promise<MacroData> {
  const cacheKey = 'fred:macro';
  const cached = await cacheGet<MacroData>(cacheKey);
  if (cached) return cached;

  const apiKey = await getCredential('fred_api_key', 'FRED_API_KEY');

  let fed: number | null = null;
  let yieldCurve: number | null = null;
  let cpi: number | null = null;

  if (apiKey) {
    [fed, yieldCurve, cpi] = await Promise.all([
      fetchSeries('DFF', apiKey),
      fetchSeries('T10Y2Y', apiKey),
      fetchSeries('CPIAUCSL', apiKey),
    ]);
  } else {
    // Sans clé FRED, utiliser des valeurs de fallback raisonnables
    console.log('[FRED] No API key configured, using fallback macro data');
  }

  // Dériver le régime macro
  let macro_regime: MacroData['macro_regime'] = 'NEUTRE';
  if (fed !== null && yieldCurve !== null) {
    if (fed > 4.5 && yieldCurve < 0) macro_regime = 'RESTRICTIF';
    else if (fed < 2.5 && yieldCurve > 0.5) macro_regime = 'EXPANSIF';
  }

  const summary = buildMacroSummary(fed, yieldCurve, cpi, macro_regime);

  const result: MacroData = {
    fed_funds_rate: fed,
    yield_curve: yieldCurve,
    cpi_yoy: cpi,
    macro_regime,
    summary,
  };

  await cacheSet(cacheKey, result, TTL.MACRO);
  console.log(`[FRED] Macro: Fed=${fed}% Curve=${yieldCurve} CPI=${cpi} Régime=${macro_regime}`);
  return result;
}

function buildMacroSummary(
  fed: number | null,
  curve: number | null,
  cpi: number | null,
  regime: string
): string {
  const parts: string[] = [];
  if (fed !== null) parts.push(`Taux Fed ${fed.toFixed(2)}%`);
  if (curve !== null) parts.push(`Courbe 10Y-2Y ${curve > 0 ? '+' : ''}${curve.toFixed(2)}%`);
  if (cpi !== null) parts.push(`CPI ${cpi.toFixed(1)}`);
  parts.push(`Régime ${regime}`);
  return parts.join(' | ');
}
