import { getCredential } from '../config/credentials';

/** Static fallback constants — used only if DB has no value configured. */
const MODEL_DEFAULTS = {
  LIGHT: process.env.MODEL_LIGHT || 'anthropic/claude-haiku-4-5',
  MID: process.env.MODEL_MID || 'anthropic/claude-sonnet-4-5',
  STRONG: process.env.MODEL_STRONG || 'anthropic/claude-opus-4',
} as const;

/**
 * Resolves the current model IDs dynamically from the database config,
 * falling back to environment variables, then to hardcoded defaults.
 *
 * This ensures that UI-driven model changes take effect immediately
 * without requiring a container restart.
 */
export async function getModels(): Promise&lt;{ LIGHT: string; MID: string; STRONG: string }&gt; {
  const [light, mid, strong] = await Promise.all([
    getCredential('model_light', 'MODEL_LIGHT'),
    getCredential('model_mid', 'MODEL_MID'),
    getCredential('model_strong', 'MODEL_STRONG'),
  ]);
  return {
    LIGHT: light || MODEL_DEFAULTS.LIGHT,
    MID: mid || MODEL_DEFAULTS.MID,
    STRONG: strong || MODEL_DEFAULTS.STRONG,
  };
}

/**
 * @deprecated Use `getModels()` for dynamic resolution.
 * Kept for backward compatibility during the transition.
 */
export const MODELS = MODEL_DEFAULTS;
