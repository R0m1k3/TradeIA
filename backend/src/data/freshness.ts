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

export function summarizeFreshness(sources: DataSourceFreshness[], notes: string[] = []): DataQualitySummary {
  if (sources.length === 0) {
    return { status: 'missing', score: 0, sources: [], notes: ['Aucune source disponible'] };
  }

  const score = Math.round(
    sources.reduce((sum, source) => sum + STATUS_SCORE[source.status], 0) / sources.length
  );

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
