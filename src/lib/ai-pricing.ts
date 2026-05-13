// Pricing map for LLM cost estimation. Prices are USD per million tokens.
// Model keys match the values used in the CLI config (`src/lib/cli-config.ts`)
// and the model strings the runner records when capturing token usage.
// Update these as providers publish new rates — costs are estimated at the
// moment of recording, with no historical backfill.

export type ModelPrice = {
  input_per_mtok: number;
  output_per_mtok: number;
};

export const AI_PRICING: Record<string, Record<string, ModelPrice>> = {
  claude: {
    opus: { input_per_mtok: 15.0, output_per_mtok: 75.0 },
    sonnet: { input_per_mtok: 3.0, output_per_mtok: 15.0 },
    haiku: { input_per_mtok: 1.0, output_per_mtok: 5.0 },
  },
  codex: {
    "gpt-5.5": { input_per_mtok: 1.25, output_per_mtok: 10.0 },
    "gpt-5.4": { input_per_mtok: 0.5, output_per_mtok: 4.0 },
  },
  gemini: {
    "gemini-2.5-pro": { input_per_mtok: 1.25, output_per_mtok: 10.0 },
    "gemini-2.5-flash": { input_per_mtok: 0.3, output_per_mtok: 2.5 },
  },
};

export type CostEstimate = {
  cost: number | null;
  known: boolean;
};

export function estimateCostUsd(
  provider: string | null | undefined,
  model: string | null | undefined,
  inputTokens: number,
  outputTokens: number,
): CostEstimate {
  if (!provider || !model) return { cost: null, known: false };
  const price = AI_PRICING[provider]?.[model];
  if (!price) return { cost: null, known: false };
  const cost =
    (inputTokens / 1_000_000) * price.input_per_mtok +
    (outputTokens / 1_000_000) * price.output_per_mtok;
  return { cost, known: true };
}
