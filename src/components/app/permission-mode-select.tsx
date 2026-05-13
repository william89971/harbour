"use client";

import { Label } from "@/components/ui/label";
import { ShieldCheck, ShieldAlert, Settings2 } from "lucide-react";

export type PermissionMode = "safe" | "custom" | "unrestricted";

type Option = {
  value: PermissionMode;
  label: string;
  tag: string;
  description: string;
  Icon: typeof ShieldCheck;
};

/** Build the option list for a given cli. Wording differs per provider
 *  because safe-mode actually means different things — Claude has a
 *  built-in permission system, the shell CLIs get Harbour-level shim
 *  wrappers, and api agents get tool-permission gating. */
function optionsFor(cli: string | null): Option[] {
  if (cli === "claude") {
    return [
      { value: "safe", label: "Safe", tag: "recommended", Icon: ShieldCheck,
        description: "Harbour writes a .claude/settings.json that denies dangerous commands (rm -rf, sudo, ssh) and reads of secrets (.env, ~/.ssh, encryption keys)." },
      { value: "custom", label: "Custom", tag: "advanced", Icon: Settings2,
        description: "You manage .claude/settings.json yourself. Use this if the default deny-list is too strict or too loose for your workflow." },
      { value: "unrestricted", label: "Unrestricted", tag: "risky", Icon: ShieldAlert,
        description: "Runs with --dangerously-skip-permissions. Full access to the host machine. Only use in trusted, sandboxed environments." },
    ];
  }
  if (cli === "api") {
    return [
      { value: "safe", label: "Safe", tag: "recommended", Icon: ShieldCheck,
        description: "API agents have no shell access. In Safe mode only the minimum tools (read/write docs, read databases, post activity, set status) are enabled by default." },
      { value: "custom", label: "Custom", tag: "advanced", Icon: Settings2,
        description: "All tools enabled by default. Toggle individual tool permissions below to fine-tune what the model can do." },
      { value: "unrestricted", label: "Unrestricted", tag: "risky", Icon: ShieldAlert,
        description: "Every tool permission on by default. API agents never get shell access regardless of mode — the only attack surface is the Harbour HTTP API." },
    ];
  }
  // codex / gemini / shell — Harbour-level safe mode is a soft sandbox.
  return [
    { value: "safe", label: "Safe", tag: "recommended", Icon: ShieldCheck,
      description: "Harbour-level soft sandbox: shim wrappers block rm/sudo/chmod/chown/ssh/scp and curl with Authorization headers. Not a true sandbox — an LLM that calls /bin/rm by absolute path or shells through Python can still escape." },
    { value: "custom", label: "Custom", tag: "advanced", Icon: Settings2,
      description: "Same shim PATH as Safe, but tool permissions all enabled by default. Tune the tool grid below." },
    { value: "unrestricted", label: "Unrestricted", tag: "risky", Icon: ShieldAlert,
      description: "No shim wrappers. The CLI sees an unmodified PATH. Use only in trusted environments." },
  ];
}

const TAG_STYLES: Record<string, string> = {
  recommended: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  advanced:    "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  risky:       "bg-rose-500/10 text-rose-700 dark:text-rose-400",
};

/**
 * Permission-mode picker for harbour agents.
 *
 * - Claude: native permission system via .claude/settings.json.
 * - Codex / Gemini / Shell: Harbour-level soft sandbox via PATH-shim
 *   wrappers. Honest about being best-effort.
 * - API: no shell at all; mode controls default tool-permission selection.
 *
 * For external/no-cli agents the caller should hide this control entirely.
 */
export function PermissionModeSelect({
  cli,
  value,
  onChange,
  disabled,
}: {
  cli: string | null;
  value: PermissionMode;
  onChange: (mode: PermissionMode) => void;
  disabled?: boolean;
}) {
  const options = optionsFor(cli);
  return (
    <div className="space-y-2">
      <Label>Permissions</Label>
      <div className="grid gap-2">
        {options.map(opt => {
          const selected = opt.value === value;
          return (
            <label
              key={opt.value}
              className={`flex items-start gap-3 rounded-md border p-3 cursor-pointer transition-colors ${
                selected ? "border-primary bg-primary/5" : "hover:bg-muted/50"
              } ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
            >
              <input
                type="radio"
                name="permission-mode"
                value={opt.value}
                checked={selected}
                onChange={() => onChange(opt.value)}
                disabled={disabled}
                className="mt-1"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <opt.Icon className={`h-4 w-4 ${
                    opt.value === "safe" ? "text-emerald-600" :
                    opt.value === "custom" ? "text-blue-600" : "text-rose-600"
                  }`} />
                  <span className="text-sm font-medium">{opt.label}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${TAG_STYLES[opt.tag]}`}>{opt.tag}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}

const BADGE_STYLES: Record<PermissionMode, string> = {
  safe:         "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  custom:       "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  unrestricted: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
};

/** Small inline badge for agent lists / detail pages. */
export function PermissionBadge({ mode }: { mode: PermissionMode | string }) {
  const m = (mode as PermissionMode);
  const style = BADGE_STYLES[m] ?? "bg-muted text-muted-foreground";
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded ${style}`} title={`Permission mode: ${m}`}>
      {m}
    </span>
  );
}
