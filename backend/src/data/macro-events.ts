/**
 * High-impact US macro events that historically cause vol spikes (1–3% intraday moves).
 * On these days, swing trades held into the print risk getting stopped out by macro noise
 * unrelated to the technical setup.
 *
 * Maintained as a static schedule. Update each year with FOMC + CPI + NFP dates.
 * Source: Fed calendar, BLS calendar.
 *
 * Logic: if today is a known event day (or +/- 1 day for FOMC), flag macro_blackout.
 * Risk agent skips new BUYs during blackout.
 */

export type MacroEventKind = 'FOMC' | 'CPI' | 'NFP' | 'PPI';

export interface MacroEvent {
  date: string;     // YYYY-MM-DD (US Eastern)
  kind: MacroEventKind;
  /** Window in days around the event during which we block new entries */
  blackout_days_before: number;
  blackout_days_after: number;
}

/** 2026 high-impact US macro events (FOMC, CPI, NFP). PPI rolling. */
const EVENTS_2026: MacroEvent[] = [
  // FOMC meetings (rate decisions) — block 1 day before, 1 day after
  { date: '2026-01-28', kind: 'FOMC', blackout_days_before: 1, blackout_days_after: 1 },
  { date: '2026-03-18', kind: 'FOMC', blackout_days_before: 1, blackout_days_after: 1 },
  { date: '2026-04-29', kind: 'FOMC', blackout_days_before: 1, blackout_days_after: 1 },
  { date: '2026-06-17', kind: 'FOMC', blackout_days_before: 1, blackout_days_after: 1 },
  { date: '2026-07-29', kind: 'FOMC', blackout_days_before: 1, blackout_days_after: 1 },
  { date: '2026-09-16', kind: 'FOMC', blackout_days_before: 1, blackout_days_after: 1 },
  { date: '2026-11-04', kind: 'FOMC', blackout_days_before: 1, blackout_days_after: 1 },
  { date: '2026-12-16', kind: 'FOMC', blackout_days_before: 1, blackout_days_after: 1 },

  // CPI (inflation) — block same day, allow next-day re-entry
  { date: '2026-01-13', kind: 'CPI', blackout_days_before: 0, blackout_days_after: 0 },
  { date: '2026-02-11', kind: 'CPI', blackout_days_before: 0, blackout_days_after: 0 },
  { date: '2026-03-12', kind: 'CPI', blackout_days_before: 0, blackout_days_after: 0 },
  { date: '2026-04-14', kind: 'CPI', blackout_days_before: 0, blackout_days_after: 0 },
  { date: '2026-05-12', kind: 'CPI', blackout_days_before: 0, blackout_days_after: 0 },
  { date: '2026-06-10', kind: 'CPI', blackout_days_before: 0, blackout_days_after: 0 },
  { date: '2026-07-15', kind: 'CPI', blackout_days_before: 0, blackout_days_after: 0 },
  { date: '2026-08-12', kind: 'CPI', blackout_days_before: 0, blackout_days_after: 0 },
  { date: '2026-09-10', kind: 'CPI', blackout_days_before: 0, blackout_days_after: 0 },
  { date: '2026-10-13', kind: 'CPI', blackout_days_before: 0, blackout_days_after: 0 },
  { date: '2026-11-12', kind: 'CPI', blackout_days_before: 0, blackout_days_after: 0 },
  { date: '2026-12-10', kind: 'CPI', blackout_days_before: 0, blackout_days_after: 0 },

  // NFP (jobs report) — block same day
  { date: '2026-01-09', kind: 'NFP', blackout_days_before: 0, blackout_days_after: 0 },
  { date: '2026-02-06', kind: 'NFP', blackout_days_before: 0, blackout_days_after: 0 },
  { date: '2026-03-06', kind: 'NFP', blackout_days_before: 0, blackout_days_after: 0 },
  { date: '2026-04-03', kind: 'NFP', blackout_days_before: 0, blackout_days_after: 0 },
  { date: '2026-05-01', kind: 'NFP', blackout_days_before: 0, blackout_days_after: 0 },
  { date: '2026-06-05', kind: 'NFP', blackout_days_before: 0, blackout_days_after: 0 },
  { date: '2026-07-02', kind: 'NFP', blackout_days_before: 0, blackout_days_after: 0 },
  { date: '2026-08-07', kind: 'NFP', blackout_days_before: 0, blackout_days_after: 0 },
  { date: '2026-09-04', kind: 'NFP', blackout_days_before: 0, blackout_days_after: 0 },
  { date: '2026-10-02', kind: 'NFP', blackout_days_before: 0, blackout_days_after: 0 },
  { date: '2026-11-06', kind: 'NFP', blackout_days_before: 0, blackout_days_after: 0 },
  { date: '2026-12-04', kind: 'NFP', blackout_days_before: 0, blackout_days_after: 0 },
];

const ALL_EVENTS: MacroEvent[] = [...EVENTS_2026];

function dateOnlyUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function diffDays(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

/** Returns the active blackout event if today falls in any blackout window, else null. */
export function isMacroBlackout(now: Date = new Date()): MacroEvent | null {
  const today = dateOnlyUTC(now);
  for (const ev of ALL_EVENTS) {
    const evDate = new Date(ev.date + 'T00:00:00Z');
    const diff = diffDays(new Date(today + 'T00:00:00Z'), evDate);
    if (diff >= -ev.blackout_days_before && diff <= ev.blackout_days_after) {
      return ev;
    }
  }
  return null;
}

/** Returns the next upcoming event (or null if none). Useful for UI display. */
export function nextMacroEvent(now: Date = new Date()): MacroEvent | null {
  const todayMs = new Date(dateOnlyUTC(now) + 'T00:00:00Z').getTime();
  const future = ALL_EVENTS.filter((e) => new Date(e.date + 'T00:00:00Z').getTime() >= todayMs);
  return future.length > 0 ? future[0] : null;
}
