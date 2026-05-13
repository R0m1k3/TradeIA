export type DataFreshnessStatus = 'live' | 'fresh' | 'delayed' | 'limited' | 'stale' | 'missing';

export interface DataSourceFreshness {
  source: string;
  status: DataFreshnessStatus;
  fetched_at: string;
  observed_at?: string;
  age_seconds?: number;
  message: string;
}

export interface DataQualitySummary {
  status: DataFreshnessStatus;
  score: number;
  sources: DataSourceFreshness[];
  notes: string[];
}

const STATUS_SCORE: Record<DataFreshnessStatus, number> = {
  live: 100,
  fresh: 90,
  delayed: 70,
  limited: 55,
  stale: 35,
  missing: 0,
};

export function sourceFreshness(
  source: string,
  status: DataFreshnessStatus,
  message: string,
  observedAt?: string | null
): DataSourceFreshness {
  const fetchedAt = new Date().toISOString();
  const observed = observedAt || undefined;
  const observedTime = observed ? new Date(observed).getTime() : NaN;
  return {
    source,
    status,
    fetched_at: fetchedAt,
    observed_at: observed,
    age_seconds: Number.isFinite(observedTime) ? Math.max(0, Math.round((Date.now() - observedTime) / 1000)) : undefined,
    message,
  };
}

/**
 * Apply age-based decay to a source's freshness score.
 * Data older than 5 minutes starts decaying; by 60 minutes the score is halved.
 */
function ageDecay(ageSeconds: number | undefined): number {
  if (ageSeconds === undefined || ageSeconds < 0) return 1.0;
  if (ageSeconds < 300) return 1.0;                    // < 5 min: full score
  if (ageSeconds < 900) return 0.9;                     // 5-15 min: 90%
  if (ageSeconds < 1800) return 0.8;                    // 15-30 min: 80%
  if (ageSeconds < 3600) return 0.65;                    // 30-60 min: 65%
  return Math.max(0.2, 0.5 - (ageSeconds - 3600) / 72000); // decays to 0.2 over 20h
}

export function summarizeFreshness(sources: DataSourceFreshness[], notes: string[] = []): DataQualitySummary {
  if (sources.length === 0) {
    return { status: 'missing', score: 0, sources: [], notes: ['Aucune source disponible'] };
  }

  // Base score from source status, then apply age decay per source
  const scores = sources.map((s) => {
    const baseScore = STATUS_SCORE[s.status];
    const decay = ageDecay(s.age_seconds);
    return Math.round(baseScore * decay);
  });
  const score = Math.round(scores.reduce((sum, s) => sum + s, 0) / sources.length);

  let status: DataFreshnessStatus = 'fresh';
  if (sources.some((source) => source.status === 'live')) status = 'live';
  if (score < 80) status = 'delayed';
  if (score < 60) status = 'limited';
  if (score < 40) status = 'stale';
  if (score < 15) status = 'missing';

  return { status, score, sources, notes };
}

export function latestObservedAt(rows: unknown[]): string | null {
  const last = rows[rows.length - 1] as { time?: string } | undefined;
  return typeof last?.time === 'string' ? last.time : null;
}
