/** Capability flags describing how each provider's safety model works. The
 *  UI consults these to render honest mode banners, and the runner uses
 *  them to decide whether to install shim wrappers or branch into the
 *  API-agent code path. */
export type ProviderCapabilities = {
  /** True for Claude only today — it has a built-in permission system via
   *  .claude/settings.json. Other providers rely on Harbour-level controls. */
  supportsNativePermissions: boolean;
  /** Whether Harbour can enforce a soft safe-mode for this provider via
   *  shim wrappers (Codex/Gemini/Shell) or tool restrictions (API). */
  supportsHarbourSafeMode: boolean;
  /** Whether the CLI requires a bypass/approval flag for non-interactive
   *  runs (Codex --dangerously-bypass..., Gemini --yolo). Driven by the
   *  CLI design, not by Harbour. */
  requiresBypassForNonInteractive: boolean;
  /** Whether the provider gives the LLM access to a real shell. False for
   *  the API-agent provider — the only "tools" the LLM gets are Harbour
   *  HTTP endpoints. */
  hasShellAccess: boolean;
  /** One-line summary the UI surfaces under the permission picker. */
  safetyNotes: string;
};

export type CliConfig = {
  models: string[];
  thinkingLabel: string;
  thinkingOptions: string[];
  /** UI display name; falls back to the key (e.g. "claude") when absent. */
  displayName?: string;
  /** When true, the agent's `cli` requires user-supplied shell command/cwd. */
  requiresCustomCommand?: boolean;
  capabilities: ProviderCapabilities;
};

export const CLI_CONFIG: Record<string, CliConfig> = {
  claude: {
    models: ["sonnet", "opus", "haiku"],
    thinkingLabel: "Effort",
    thinkingOptions: ["low", "medium", "high", "max"],
    displayName: "Claude Code",
    capabilities: {
      supportsNativePermissions: true,
      supportsHarbourSafeMode: true,
      requiresBypassForNonInteractive: true,
      hasShellAccess: true,
      safetyNotes: "Safe mode uses Claude's own .claude/settings.json permission system.",
    },
  },
  codex: {
    models: ["gpt-5.5", "gpt-5.4"],
    thinkingLabel: "Reasoning",
    thinkingOptions: ["low", "medium", "high", "xhigh"],
    displayName: "Codex",
    capabilities: {
      supportsNativePermissions: false,
      supportsHarbourSafeMode: true,
      requiresBypassForNonInteractive: true,
      hasShellAccess: true,
      safetyNotes: "Codex has no native permission system. Safe mode is a Harbour-level soft sandbox: PATH-shim wrappers block common dangerous commands.",
    },
  },
  gemini: {
    models: ["gemini-2.5-pro", "gemini-2.5-flash"],
    thinkingLabel: "Thinking",
    // Gemini 0.40+ removed --thinking; reasoning depth is controlled by model
    // selection now. Empty array hides the thinking selector in the UI.
    thinkingOptions: [],
    displayName: "Gemini CLI",
    capabilities: {
      supportsNativePermissions: false,
      supportsHarbourSafeMode: true,
      requiresBypassForNonInteractive: true,
      hasShellAccess: true,
      safetyNotes: "Gemini has no native permission system. Safe mode is a Harbour-level soft sandbox: PATH-shim wrappers block common dangerous commands.",
    },
  },
  shell: {
    models: [],
    thinkingLabel: "",
    thinkingOptions: [],
    displayName: "Custom Shell Agent",
    requiresCustomCommand: true,
    capabilities: {
      supportsNativePermissions: false,
      supportsHarbourSafeMode: true,
      requiresBypassForNonInteractive: false,
      hasShellAccess: true,
      safetyNotes: "The command runs with the runner's full privileges. Safe mode prepends shim wrappers to PATH but cannot stop a command that calls /bin/rm by absolute path.",
    },
  },
  api: {
    // Common OpenAI-compatible models. The select is intentionally short;
    // the user can type any model the endpoint accepts via the create form.
    models: ["deepseek-chat", "deepseek-reasoner", "moonshot-v1-32k", "moonshot-v1-128k", "gpt-4o-mini", "gpt-4o"],
    thinkingLabel: "",
    thinkingOptions: [],
    displayName: "API Agent",
    capabilities: {
      supportsNativePermissions: false,
      supportsHarbourSafeMode: true,
      requiresBypassForNonInteractive: false,
      hasShellAccess: false,
      safetyNotes: "API agents have no shell access. The model can only invoke Harbour HTTP tools you've enabled in tool permissions.",
    },
  },
};

/** Convenience presets for the API-agent provider. Each maps a friendly
 *  vendor name to a base URL and the env-var name the user typically uses.
 *  The dashboard tile flow auto-fills both, then the user picks a model
 *  and supplies the API key via that env var on the runner host. */
export type ApiPreset = {
  id: string;
  displayName: string;
  apiBaseUrl: string;
  defaultModel: string;
  defaultApiKeyEnv: string;
  docsUrl?: string;
};

export const API_PRESETS: ApiPreset[] = [
  {
    id: "deepseek",
    displayName: "DeepSeek",
    apiBaseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    defaultApiKeyEnv: "DEEPSEEK_API_KEY",
    docsUrl: "https://api-docs.deepseek.com/",
  },
  {
    id: "kimi",
    displayName: "Kimi (Moonshot)",
    apiBaseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-32k",
    defaultApiKeyEnv: "MOONSHOT_API_KEY",
    docsUrl: "https://platform.moonshot.cn/docs",
  },
  {
    id: "openai",
    displayName: "OpenAI",
    apiBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    defaultApiKeyEnv: "OPENAI_API_KEY",
    docsUrl: "https://platform.openai.com/docs",
  },
];
