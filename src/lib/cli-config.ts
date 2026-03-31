export type CliConfig = {
  models: string[];
  thinkingLabel: string;
  thinkingOptions: string[];
};

export const CLI_CONFIG: Record<string, CliConfig> = {
  claude: {
    models: ["sonnet", "opus", "haiku"],
    thinkingLabel: "Effort",
    thinkingOptions: ["low", "medium", "high", "max"],
  },
  codex: {
    models: ["gpt-5.4", "o3", "gpt-4.1"],
    thinkingLabel: "Reasoning",
    thinkingOptions: ["low", "medium", "high"],
  },
  gemini: {
    models: ["gemini-2.5-pro", "gemini-2.5-flash"],
    thinkingLabel: "Thinking",
    thinkingOptions: ["low", "medium", "high"],
  },
};
