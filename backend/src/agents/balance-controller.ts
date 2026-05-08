import type { MarketSegment } from './discovery';
import type { RegimeAssessment } from './regime';

export type { MarketSegment };

export interface AllocationBudget {
  segments: Partial<Record<MarketSegment, { slots: number; candidates_to_analyze: number }>>;
  total_new_slots: number;
  swap_allowed: boolean;
  risk_per_slot_pct: number;
  regime?: RegimeAssessment;
}

/** Base slots per segment when both markets are open */
const BASE_SLOTS: Record<MarketSegment, number> = {
  nasdaq: 4,
  cac40: 2,
  dax40: 2,
  ftse100: 2,
  eu_other: 1,
};

export class BalanceController {
  compute(params: {
    nasdaq_open: boolean;
    eu_open: boolean;
    vix: number;
    fear_greed: number;
    existing_positions: Array<{ ticker: string; segment?: MarketSegment }>;
    segments_map: Record<string, MarketSegment>;
    regime?: RegimeAssessment;
  }): AllocationBudget {
    const { nasdaq_open, eu_open, vix, fear_greed, existing_positions, segments_map, regime } = params;

    // Step 1: Determine base slots per segment based on market open state
    let rawSlots: Record<MarketSegment, number> = { ...BASE_SLOTS };

    if (!nasdaq_open && eu_open) {
      // Only EU open
      rawSlots = {
        nasdaq: 0,
        cac40: Math.round(BASE_SLOTS.cac40 * 1.5),
        dax40: Math.round(BASE_SLOTS.dax40 * 1.5),
        ftse100: Math.round(BASE_SLOTS.ftse100 * 1.5),
        eu_other: Math.round(BASE_SLOTS.eu_other * 1.5),
      };
    } else if (nasdaq_open && !eu_open) {
      // Only US open
      rawSlots = {
        nasdaq: 6,
        cac40: 0,
        dax40: 0,
        ftse100: 0,
        eu_other: 0,
      };
    }

    // Step 2: Apply VIX reduction
    let vixFactor = 1.0;
    if (vix > 30) {
      vixFactor = 0.5;
    } else if (vix > 25) {
      vixFactor = 0.7; // reduce by 30%
    }

    // Step 3: Apply fear & greed reduction
    let fgFactor = 1.0;
    if (fear_greed < 25) {
      fgFactor = 0.8; // reduce by 20%
    }

    // Regime multiplier: bull_trend boosts, bear_trend / transition reduce.
    const regimeFactor = regime?.sizing_multiplier ?? 1.0;
    const combinedFactor = vixFactor * fgFactor * regimeFactor;

    // Step 4: Count existing positions per segment
    const positionsBySegment: Partial<Record<MarketSegment, number>> = {};
    for (const pos of existing_positions) {
      const seg = pos.segment ?? segments_map[pos.ticker];
      if (seg) {
        positionsBySegment[seg] = (positionsBySegment[seg] ?? 0) + 1;
      }
    }

    // Step 5: Compute final slots
    const segments: Partial<Record<MarketSegment, { slots: number; candidates_to_analyze: number }>> = {};
    let total_new_slots = 0;
    let swap_allowed = false;

    for (const [seg, base] of Object.entries(rawSlots) as Array<[MarketSegment, number]>) {
      const reducedSlots = Math.floor(base * combinedFactor);
      const existingCount = positionsBySegment[seg] ?? 0;
      const freeSlots = Math.max(0, reducedSlots - existingCount);

      // If no free slots but positions exist → swap might be allowed
      if (freeSlots === 0 && existingCount > 0) {
        swap_allowed = true;
      }

      if (reducedSlots > 0) {
        segments[seg] = {
          slots: freeSlots,
          candidates_to_analyze: freeSlots * 3 || (existingCount > 0 ? 3 : 0),
        };
        total_new_slots += freeSlots;
      }
    }

    // risk_per_slot_pct based on VIX
    let risk_per_slot_pct: number;
    if (vix > 25) {
      risk_per_slot_pct = 1.5;
    } else if (vix > 20) {
      risk_per_slot_pct = 2.0;
    } else {
      risk_per_slot_pct = 2.5;
    }

    return {
      segments,
      total_new_slots,
      swap_allowed,
      risk_per_slot_pct,
      regime,
    };
  }
}
