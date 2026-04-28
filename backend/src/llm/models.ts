export const MODELS = {
  LIGHT: process.env.MODEL_LIGHT || 'anthropic/claude-haiku-4-5',
  MID: process.env.MODEL_MID || 'anthropic/claude-sonnet-4-5',
  STRONG: process.env.MODEL_STRONG || 'anthropic/claude-opus-4',
} as const;
