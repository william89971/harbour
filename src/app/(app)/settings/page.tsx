"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Trash2, Plus, Copy, Check } from "lucide-react";
import { useApp } from "@/components/app/app-context";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CLI_CONFIG } from "@/lib/cli-config";
import { ModelThinkingSelect, SELECT_CLASS } from "@/components/app/model-thinking-select";
import { AutonomyApprovalsPanel } from "@/components/app/autonomy-approvals-panel";
import { AutonomyPoliciesPanel } from "@/components/app/autonomy-policies-panel";
import { RoleGate } from "@/components/app/role-gate";

type Settings = Record<string, string>;

type VideoCheck = {
  ffmpeg: boolean;
  whisper: boolean;
  openai: { available: boolean; reason?: string };
  gemini: { available: boolean; reason?: string };
} | null;

function VideoProcessingSettings({ settings, updateSetting }: { settings: Settings; updateSetting: (key: string, value: string) => Promise<void> }) {
  const queryClient = useQueryClient();
  const autoProcess = settings.video_auto_process === "true";
  const interval = settings.video_screenshot_interval || "5";
  const provider = settings.video_transcript_provider || "off";

  const [apiKey, setApiKey] = useState("");
  const [apiKeyDirty, setApiKeyDirty] = useState(false);

  const { data: videoCheck } = useQuery<VideoCheck>({
    queryKey: ["video-processing-check"],
    queryFn: async () => {
      const res = await fetch("/api/settings/video-processing/check");
      if (!res.ok) return null;
      return res.json();
    },
  });

  const maskedKey = provider === "openai"
    ? settings.video_openai_api_key || ""
    : provider === "gemini"
    ? settings.video_gemini_api_key || ""
    : "";

  const displayKey = apiKeyDirty ? apiKey : maskedKey;
  const settingKey = provider === "openai" ? "video_openai_api_key" : "video_gemini_api_key";

  async function saveApiKey() {
    if (!apiKeyDirty || !apiKey.trim()) {
      setApiKeyDirty(false);
      return;
    }
    await updateSetting(settingKey, apiKey.trim());
    setApiKey("");
    setApiKeyDirty(false);
    queryClient.invalidateQueries({ queryKey: ["video-processing-check"] });
  }

  return (
    <div className="rounded-lg border p-4 space-y-4">
      <div>
        <Label className="text-base font-medium">Video Processing</Label>
        <p className="text-xs text-muted-foreground mt-0.5">Automatically extract screenshots and transcripts from uploaded videos.</p>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <Label>Auto-process videos</Label>
          <p className="text-xs text-muted-foreground mt-0.5">When enabled, uploaded videos are processed automatically.</p>
        </div>
        <button
          onClick={() => updateSetting("video_auto_process", autoProcess ? "false" : "true")}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors ${autoProcess ? "bg-primary" : "bg-muted"}`}
        >
          <span className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform mt-0.5 ${autoProcess ? "translate-x-5.5 ml-0.5" : "translate-x-0.5"}`} />
        </button>
      </div>

      <div className="space-y-2">
        <Label>Screenshot interval (seconds)</Label>
        <Input
          type="number"
          min={1}
          className="font-mono text-sm w-32"
          value={interval}
          onChange={e => {
            const v = parseInt(e.target.value, 10);
            if (v > 0) updateSetting("video_screenshot_interval", String(v));
          }}
        />
      </div>

      <div className="space-y-2">
        <Label>Transcript provider</Label>
        <select
          value={provider}
          onChange={e => {
            updateSetting("video_transcript_provider", e.target.value);
            setApiKey("");
            setApiKeyDirty(false);
          }}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="off">Off</option>
          <option value="whisper">Whisper (local)</option>
          <option value="openai">OpenAI</option>
          <option value="gemini">Gemini</option>
        </select>
      </div>

      {videoCheck && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span className={videoCheck.ffmpeg ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
            ffmpeg: {videoCheck.ffmpeg ? "\u2713 detected" : "\u2717 not found"}
          </span>
          {provider === "whisper" && (
            <span className={videoCheck.whisper ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
              whisper: {videoCheck.whisper ? "\u2713 detected" : "\u2717 not found"}
            </span>
          )}
          {provider === "openai" && (
            <span className={videoCheck.openai.available ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
              OpenAI: {videoCheck.openai.available ? "\u2713 ready" : `\u2717 ${videoCheck.openai.reason || "not available"}`}
            </span>
          )}
          {provider === "gemini" && (
            <span className={videoCheck.gemini.available ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
              Gemini: {videoCheck.gemini.available ? "\u2713 ready" : `\u2717 ${videoCheck.gemini.reason || "not available"}`}
            </span>
          )}
        </div>
      )}

      {(provider === "openai" || provider === "gemini") && (
        <div className="space-y-2">
          <Label>{provider === "openai" ? "OpenAI API Key" : "Gemini API Key"}</Label>
          <Input
            type="text"
            className="font-mono text-sm"
            placeholder={provider === "openai" ? "sk-..." : "AI..."}
            value={displayKey}
            onChange={e => { setApiKey(e.target.value); setApiKeyDirty(true); }}
            onBlur={saveApiKey}
            onKeyDown={e => { if (e.key === "Enter") saveApiKey(); }}
          />
        </div>
      )}
    </div>
  );
}

function GitHubIntegrationSettings() {
  const queryClient = useQueryClient();
  const { data: config } = useQuery<{
    owner: string; repo: string; defaultBranch: string; tokenEnvVarName: string; tokenConfigured: boolean;
  } | null>({
    queryKey: ["github-config"],
    queryFn: async () => {
      const res = await fetch("/api/integrations/github/config");
      if (!res.ok) return null;
      return res.json();
    },
  });

  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);

  async function saveField(key: "owner" | "repo" | "defaultBranch" | "tokenEnvVarName", value: string) {
    const res = await fetch("/api/integrations/github/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: value.trim() }),
    });
    if (res.ok) queryClient.invalidateQueries({ queryKey: ["github-config"] });
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/integrations/github/summary");
      const json = await res.json();
      if (!res.ok) {
        setTestResult({ ok: false, message: json.error || `HTTP ${res.status}` });
      } else if (!json.configured) {
        setTestResult({ ok: false, message: "Not configured — fill in the fields above first." });
      } else if (json.errors && json.errors.length > 0) {
        setTestResult({ ok: false, message: json.errors[0] });
      } else if (json.repo) {
        setTestResult({ ok: true, message: `Connected to ${json.repo.full_name}` });
      } else {
        setTestResult({ ok: false, message: "Unknown response shape." });
      }
    } catch (err) {
      setTestResult({ ok: false, message: (err as Error).message });
    } finally {
      setTesting(false);
    }
  }

  const owner = config?.owner ?? "";
  const repo = config?.repo ?? "";
  const defaultBranch = config?.defaultBranch ?? "";
  const tokenEnvVarName = config?.tokenEnvVarName ?? "GITHUB_TOKEN";
  const tokenConfigured = !!config?.tokenConfigured;

  return (
    <RoleGate
      action="manageGlobalSettings"
      fallback={
        <div className="rounded-lg border p-4 space-y-2 opacity-60">
          <Label className="text-base font-medium">GitHub</Label>
          <p className="text-xs text-muted-foreground">Admin-only. Configured by an admin elsewhere.</p>
        </div>
      }
    >
      <div className="rounded-lg border p-4 space-y-4">
        <div>
          <Label className="text-base font-medium">GitHub</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Read-only repo awareness. Store the token in <Link href="/env-vars" className="underline">Env Vars</Link> and reference it by name here. No mutations are performed.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Owner</Label>
            <Input defaultValue={owner} placeholder="geekforbrains" onBlur={e => saveField("owner", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Repo</Label>
            <Input defaultValue={repo} placeholder="harbour" onBlur={e => saveField("repo", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Default branch</Label>
            <Input defaultValue={defaultBranch} placeholder="main" onBlur={e => saveField("defaultBranch", e.target.value)} />
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Token env var name</Label>
          <Input
            defaultValue={tokenEnvVarName}
            placeholder="GITHUB_TOKEN"
            onBlur={e => saveField("tokenEnvVarName", e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {tokenConfigured
              ? <>Env var <span className="font-mono">{tokenEnvVarName}</span> is set. Plaintext is never exposed.</>
              : <>No env var named <span className="font-mono">{tokenEnvVarName}</span> found. <Link href="/env-vars" className="underline">Create one</Link> first.</>
            }
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleTest} disabled={testing}>
            {testing ? "Testing..." : "Test connection"}
          </Button>
          {testResult && (
            <span className={`text-xs ${testResult.ok ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}`}>
              {testResult.ok ? "✓ " : "✗ "}{testResult.message}
            </span>
          )}
        </div>
      </div>
    </RoleGate>
  );
}

function GmailIntegrationSettings() {
  const queryClient = useQueryClient();
  const { data: config } = useQuery<{
    clientIdEnvVarName: string;
    clientSecretEnvVarName: string;
    refreshTokenEnvVarName: string;
    fromEmail: string;
    configured: boolean;
    tokenConfigured: boolean;
  } | null>({
    queryKey: ["gmail-config"],
    queryFn: async () => {
      const r = await fetch("/api/integrations/gmail/config");
      if (!r.ok) return null;
      return r.json();
    },
  });

  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [testing, setTesting] = useState(false);

  async function saveField(key: "clientIdEnvVarName" | "clientSecretEnvVarName" | "refreshTokenEnvVarName" | "fromEmail", value: string) {
    const r = await fetch("/api/integrations/gmail/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: value.trim() }),
    });
    if (r.ok) queryClient.invalidateQueries({ queryKey: ["gmail-config"] });
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await fetch("/api/integrations/gmail/test", { method: "POST" });
      setTestResult(await r.json());
    } finally {
      setTesting(false);
    }
  }

  const cid = config?.clientIdEnvVarName ?? "GMAIL_CLIENT_ID";
  const cs = config?.clientSecretEnvVarName ?? "GMAIL_CLIENT_SECRET";
  const rt = config?.refreshTokenEnvVarName ?? "GMAIL_REFRESH_TOKEN";
  const fromEmail = config?.fromEmail ?? "";

  return (
    <RoleGate
      action="manageGlobalSettings"
      fallback={
        <div className="rounded-lg border p-4 space-y-2 opacity-60">
          <Label className="text-base font-medium">Gmail</Label>
          <p className="text-xs text-muted-foreground">Admin-only.</p>
        </div>
      }
    >
      <div className="rounded-lg border p-4 space-y-4">
        <div>
          <Label className="text-base font-medium">Gmail</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Creates Gmail drafts (never sends). Store the three OAuth env vars in{" "}
            <Link href="/env-vars" className="underline">Env Vars</Link>. Generate the refresh token via the{" "}
            <a
              href="https://developers.google.com/oauthplayground/"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Google OAuth Playground
            </a>{" "}
            with scope <span className="font-mono">https://www.googleapis.com/auth/gmail.modify</span>.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Client ID env var</Label>
            <Input defaultValue={cid} onBlur={e => saveField("clientIdEnvVarName", e.target.value)} placeholder="GMAIL_CLIENT_ID" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Client Secret env var</Label>
            <Input defaultValue={cs} onBlur={e => saveField("clientSecretEnvVarName", e.target.value)} placeholder="GMAIL_CLIENT_SECRET" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Refresh Token env var</Label>
            <Input defaultValue={rt} onBlur={e => saveField("refreshTokenEnvVarName", e.target.value)} placeholder="GMAIL_REFRESH_TOKEN" />
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">From email</Label>
          <Input defaultValue={fromEmail} onBlur={e => saveField("fromEmail", e.target.value)} placeholder="you@yourdomain.com" type="email" />
          <p className="text-xs text-muted-foreground">
            {config?.tokenConfigured
              ? <>Env vars detected.{" "}{config.configured ? "Ready to test." : "Set the from email to enable drafts."}</>
              : <>One or more env vars not found. <Link href="/env-vars" className="underline">Create them</Link> first.</>
            }
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleTest} disabled={testing}>
            {testing ? "Testing..." : "Test connection"}
          </Button>
          {testResult && testResult.ok && (
            <span className="text-xs text-emerald-700 dark:text-emerald-400">✓ Connected</span>
          )}
          {testResult && !testResult.ok && (
            <span className="text-xs text-rose-700 dark:text-rose-400">✗ {testResult.error ?? "Failed"}</span>
          )}
        </div>
      </div>
    </RoleGate>
  );
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { projects, activeProjectId, setActiveProjectId } = useApp();
  const activeProject = activeProjectId ? projects.find(p => p.id === activeProjectId) : null;

  const [tzSearch, setTzSearch] = useState("");
  const [tzOpen, setTzOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectNameLoaded, setProjectNameLoaded] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Admin API keys
  const [newKeyName, setNewKeyName] = useState("");
  const [showNewKey, setShowNewKey] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Sync project name when active project changes
  if (activeProject && (!projectNameLoaded || projectName === "")) {
    setProjectName(activeProject.name);
    setProjectNameLoaded(true);
  }
  if (!activeProject && projectNameLoaded) {
    setProjectNameLoaded(false);
  }

  async function handleRenameProject() {
    if (!activeProjectId || !projectName.trim() || projectName === activeProject?.name) return;
    await fetch(`/api/projects/${activeProjectId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: projectName.trim() }),
    });
    queryClient.invalidateQueries({ queryKey: ["projects"] });
  }

  async function handleDeleteProject() {
    if (!activeProjectId) return;
    setDeleting(true);
    await fetch(`/api/projects/${activeProjectId}`, { method: "DELETE" });
    setActiveProjectId(null);
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    setShowDeleteConfirm(false);
    setDeleting(false);
    router.push("/");
  }

  const { data: settings, isLoading } = useQuery<Settings>({
    queryKey: ["settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      if (!res.ok) return {};
      return res.json();
    },
  });

  const { data: timezones = [] } = useQuery<string[]>({
    queryKey: ["timezones"],
    queryFn: async () => {
      const res = await fetch("/api/settings/timezones");
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: runnerInterval } = useQuery<{ pollIntervalSeconds: number; min: number; max: number; default: number }>({
    queryKey: ["runner-interval"],
    queryFn: async () => {
      const res = await fetch("/api/system/runner-interval");
      if (!res.ok) return { pollIntervalSeconds: 60, min: 5, max: 3600, default: 60 };
      return res.json();
    },
  });

  async function saveRunnerInterval(n: number) {
    const res = await fetch("/api/system/runner-interval", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pollIntervalSeconds: n }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to update polling interval" }));
      alert(err.error);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["runner-interval"] });
  }

  const { data: adminKeys = [] } = useQuery<any[]>({
    queryKey: ["admin-api-keys"],
    queryFn: async () => {
      const res = await fetch("/api/admin-api-keys");
      if (!res.ok) return [];
      return res.json();
    },
  });

  const createKeyMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch("/api/admin-api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error("Failed to create key");
      return res.json();
    },
    onSuccess: (data) => {
      setCreatedKey(data.apiKey);
      setNewKeyName("");
      queryClient.invalidateQueries({ queryKey: ["admin-api-keys"] });
    },
  });

  const deleteKeyMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/admin-api-keys/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-api-keys"] });
    },
  });

  const filteredTimezones = useMemo(() => {
    if (!tzSearch) return timezones;
    const lower = tzSearch.toLowerCase();
    return timezones.filter(tz => tz.toLowerCase().includes(lower));
  }, [timezones, tzSearch]);

  async function updateSetting(key: string, value: string) {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: value }),
    });
    if (!res.ok) { alert("Failed to update setting"); return; }
    queryClient.invalidateQueries({ queryKey: ["settings"] });
  }

  if (isLoading) return <div className="text-sm text-muted-foreground py-12 text-center">Loading...</div>;

  const timezone = settings?.timezone || "";
  const signupEnabled = settings?.signup_enabled !== "false";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">System-wide configuration.</p>
      </div>

      <div className="space-y-6 max-w-lg">
        {/* Project Settings */}
        {activeProject && (
          <div className="rounded-lg border p-4 space-y-4">
            <div>
              <Label className="text-base font-medium">Project</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Manage the current project.</p>
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={projectName}
                onChange={e => setProjectName(e.target.value)}
                onBlur={handleRenameProject}
                onKeyDown={e => { if (e.key === "Enter") handleRenameProject(); }}
                className="text-sm"
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-destructive/20 bg-destructive/5 p-3">
              <div>
                <p className="text-sm font-medium">Delete project</p>
                <p className="text-xs text-muted-foreground">Removes the project and all links. Agents, jobs, docs, and env vars are not deleted.</p>
              </div>
              <Button variant="destructive" size="sm" onClick={() => setShowDeleteConfirm(true)}>
                <Trash2 className="h-4 w-4 mr-1.5" /> Delete
              </Button>
            </div>
          </div>
        )}

        {/* Timezone */}
        <div className="space-y-2">
          <Label>Timezone</Label>
          <p className="text-xs text-muted-foreground">Used for scheduling jobs and displaying times.</p>
          <div className="relative">
            <Input
              value={tzOpen ? tzSearch : timezone}
              onChange={e => { setTzSearch(e.target.value); setTzOpen(true); }}
              onFocus={() => { setTzSearch(""); setTzOpen(true); }}
              onBlur={() => setTimeout(() => setTzOpen(false), 200)}
              placeholder="Search timezones..."
              className="font-mono text-sm"
            />
            {tzOpen && filteredTimezones.length > 0 && (
              <div className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border bg-popover shadow-md">
                {filteredTimezones.slice(0, 50).map(tz => (
                  <button
                    key={tz}
                    type="button"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => {
                      updateSetting("timezone", tz);
                      setTzOpen(false);
                      setTzSearch("");
                    }}
                    className={`w-full text-left px-3 py-2 text-sm font-mono hover:bg-accent transition-colors ${tz === timezone ? "bg-accent/50 font-medium" : ""}`}
                  >
                    {tz}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Recent Runs Limit */}
        <div className="space-y-2">
          <Label>Recent Runs Shown</Label>
          <p className="text-xs text-muted-foreground">Number of completed runs to display on the main Runs page.</p>
          <Input
            type="number"
            min={1}
            className="font-mono text-sm w-32"
            value={settings?.recent_runs_limit || "10"}
            onChange={e => {
              const v = parseInt(e.target.value, 10);
              if (v > 0) updateSetting("recent_runs_limit", String(v));
            }}
          />
        </div>

        {/* Runner Polling Interval */}
        <div className="space-y-2">
          <Label>Runner polling interval</Label>
          <p className="text-xs text-muted-foreground">
            How often the local runner polls for new work. Lower intervals reduce delay but can increase server/API usage. Range 5–3600 seconds; default 60. Changes take effect on the next <code>npm run harbour -- agent install</code>.
          </p>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={runnerInterval?.min ?? 5}
              max={runnerInterval?.max ?? 3600}
              className="font-mono text-sm w-32"
              value={runnerInterval?.pollIntervalSeconds ?? 60}
              onChange={e => {
                const v = parseInt(e.target.value, 10);
                const min = runnerInterval?.min ?? 5;
                const max = runnerInterval?.max ?? 3600;
                if (Number.isInteger(v) && v >= min && v <= max) saveRunnerInterval(v);
              }}
            />
            <span className="text-sm text-muted-foreground">seconds</span>
          </div>
          {(runnerInterval?.pollIntervalSeconds ?? 60) < 15 && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              ⚠ Below 15 seconds — each poll spawns the runner and may invoke the LLM. Expect higher cost.
            </p>
          )}
        </div>

        {/* Captain */}
        <div className="rounded-lg border p-4 space-y-4">
          <div>
            <Label className="text-base font-medium">Captain</Label>
            <p className="text-xs text-muted-foreground mt-0.5">Chat with a CLI tool directly from the dashboard.</p>
          </div>
          <div className="space-y-2">
            <Label>CLI Tool</Label>
            <select
              value={settings?.captain_cli || "claude"}
              onChange={e => updateSetting("captain_cli", e.target.value)}
              className={SELECT_CLASS}
            >
              {Object.keys(CLI_CONFIG).map(cli => (
                <option key={cli} value={cli}>{cli.charAt(0).toUpperCase() + cli.slice(1)}</option>
              ))}
            </select>
          </div>
          <ModelThinkingSelect
            cli={settings?.captain_cli || "claude"}
            model={settings?.captain_model || ""}
            thinking={settings?.captain_thinking || ""}
            onModelChange={v => updateSetting("captain_model", v)}
            onThinkingChange={v => updateSetting("captain_thinking", v)}
            defaultModelLabel="Default"
            defaultThinkingLabel="Default"
          />
          <div className="space-y-2">
            <Label>Working Directory</Label>
            <p className="text-xs text-muted-foreground mt-0.5">Where the CLI tool runs. Point this at a project repo for file access.</p>
            <Input
              placeholder="~/.harbour/captain"
              className="font-mono text-sm"
              value={settings?.captain_cwd || ""}
              onChange={e => {
                const v = e.target.value;
                if (!v.trim()) {
                  updateSetting("captain_cwd", "");
                }
              }}
              onBlur={e => {
                const v = e.target.value.trim();
                updateSetting("captain_cwd", v);
              }}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  updateSetting("captain_cwd", (e.target as HTMLInputElement).value.trim());
                }
              }}
            />
          </div>
        </div>

        {/* GitHub */}
        <GitHubIntegrationSettings />

        {/* Gmail */}
        <GmailIntegrationSettings />

        {/* Video Processing */}
        <VideoProcessingSettings settings={settings || {}} updateSetting={updateSetting} />

        {/* Signup */}
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <Label>Allow Signup</Label>
            <p className="text-xs text-muted-foreground mt-0.5">When disabled, new users cannot register.</p>
          </div>
          <button
            onClick={() => updateSetting("signup_enabled", signupEnabled ? "false" : "true")}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors ${signupEnabled ? "bg-primary" : "bg-muted"}`}
          >
            <span className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform mt-0.5 ${signupEnabled ? "translate-x-5.5 ml-0.5" : "translate-x-0.5"}`} />
          </button>
        </div>

        {/* Admin API Keys */}
        <div className="rounded-lg border p-4 space-y-4">
          <div>
            <Label className="text-base font-medium">Admin API Keys</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Keys for external agents to manage Harbour. Each key has full admin access.
            </p>
          </div>
          {adminKeys.length > 0 && (
            <div className="space-y-2">
              {adminKeys.map((key: any) => (
                <div key={key.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{key.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Created {new Date(key.created_at * 1000).toLocaleDateString()}
                      {key.last_used_at && <> &middot; Last used {new Date(key.last_used_at * 1000).toLocaleDateString()}</>}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8" onClick={() => deleteKeyMutation.mutate(key.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <Button variant="outline" size="sm" onClick={() => setShowNewKey(true)}>
            <Plus className="h-4 w-4 mr-1.5" /> New Key
          </Button>
        </div>

        <SecurityStatusSection />

        <div className="rounded-lg border p-4 space-y-4">
          <div>
            <Label className="text-base font-medium">Autonomy & Approvals</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Declarative policies decide when an agent action needs human approval. The default
              global policy gates high-risk actions (send_email, deploy_code, …) and caps medium
              spend at $10. Scope-specific policies (agent / team / workflow / department) override
              the global default in that order.
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Pending approvals</p>
            <AutonomyApprovalsPanel filter={{ status: "pending", limit: 50 }} emptyHint="No pending approvals." />
          </div>

          <RoleGate
            action="manageAutonomyPolicies"
            fallback={<p className="text-xs text-muted-foreground">Only admins can edit policies.</p>}
          >
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Policies</p>
              <AutonomyPoliciesPanel />
            </div>
          </RoleGate>
        </div>
      </div>

      {/* Create admin key dialog */}
      <Dialog open={showNewKey} onOpenChange={(open) => { setShowNewKey(open); if (!open) setNewKeyName(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Admin API Key</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Give this key a name to identify which agent or integration uses it.</p>
            <Input
              placeholder="e.g. Claude Code assistant"
              value={newKeyName}
              onChange={e => setNewKeyName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && newKeyName.trim()) { createKeyMutation.mutate(newKeyName.trim()); setShowNewKey(false); } }}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowNewKey(false)}>Cancel</Button>
            <Button
              disabled={!newKeyName.trim() || createKeyMutation.isPending}
              onClick={() => { createKeyMutation.mutate(newKeyName.trim()); setShowNewKey(false); }}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Show created key dialog */}
      <Dialog open={!!createdKey} onOpenChange={(open) => { if (!open) { setCreatedKey(null); setCopied(false); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Admin API Key Created</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Copy this invite and paste it into your management agent. The key won&apos;t be shown again.</p>
            <div className="rounded-md bg-muted px-3 py-2 text-xs font-mono whitespace-pre-wrap break-all select-all max-h-64 overflow-y-auto">
              {`You have admin access to a Harbour instance — a control plane for AI agents.\n\nSave these credentials now:\n- Admin API Key: ${createdKey}\n- Base URL: ${typeof window !== "undefined" ? window.location.origin : ""}\n\nTo get started, fetch the admin guide:\n  GET ${typeof window !== "undefined" ? window.location.origin : ""}/api/admin-guide\n  Authorization: Bearer ${createdKey}\n\nThe guide covers every endpoint you can use to manage agents, jobs, runs, docs, databases, env vars, projects, and settings.`}
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                const base = typeof window !== "undefined" ? window.location.origin : "";
                navigator.clipboard.writeText(`You have admin access to a Harbour instance — a control plane for AI agents.\n\nSave these credentials now:\n- Admin API Key: ${createdKey}\n- Base URL: ${base}\n\nTo get started, fetch the admin guide:\n  GET ${base}/api/admin-guide\n  Authorization: Bearer ${createdKey}\n\nThe guide covers every endpoint you can use to manage agents, jobs, runs, docs, databases, env vars, projects, and settings.`);
                setCopied(true);
              }}
            >
              {copied ? <><Check className="h-4 w-4 mr-1.5" /> Copied</> : <><Copy className="h-4 w-4 mr-1.5" /> Copy Invite</>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {activeProject?.name}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will remove the project and all its links. Your agents, jobs, docs, and env vars will not be deleted.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteProject} disabled={deleting}>
              {deleting ? "Deleting..." : "Delete Project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type SecurityStatus = {
  unrestrictedAgents: { id: string; name: string; cli: string | null; mode: string }[];
  customModeIssues: { id: string; name: string; mode: string; settingsJsonPath: string; error: string }[];
  workspaceCollisions: { slug: string; agents: { id: string; name: string }[] }[];
  excessivePermissions: { id: string; name: string; mode: string; flags: string[] }[];
  apiAgentsWithoutStatus: { id: string; name: string }[];
  jobEnvVars: { count: number };
};

function SecurityStatusSection() {
  const { data, isLoading } = useQuery<SecurityStatus | null>({
    queryKey: ["security-status"],
    queryFn: async () => {
      const res = await fetch("/api/system/security-status");
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 30_000,
  });

  if (isLoading || !data) return null;

  const allClear =
    data.unrestrictedAgents.length === 0 &&
    data.customModeIssues.length === 0 &&
    data.workspaceCollisions.length === 0 &&
    (data.excessivePermissions?.length ?? 0) === 0 &&
    (data.apiAgentsWithoutStatus?.length ?? 0) === 0;

  return (
    <div className="rounded-lg border p-4 space-y-4">
      <div>
        <Label className="text-base font-medium">Security</Label>
        <p className="text-xs text-muted-foreground mt-0.5">
          Risks Harbour can detect from the current configuration. Permission modes are configured per agent.
        </p>
      </div>

      <div className="space-y-3 text-sm">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Unrestricted agents</p>
          {data.unrestrictedAgents.length === 0 ? (
            <p className="text-xs text-muted-foreground mt-1">All Claude agents are using safe or custom mode.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {data.unrestrictedAgents.map(a => (
                <li key={a.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                  <div className="min-w-0">
                    <a href={`/agents/${a.id}`} className="text-sm font-medium hover:underline">{a.name}</a>
                    <p className="text-xs text-muted-foreground">{a.cli ?? "—"} · runs without sandbox</p>
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-700 dark:text-rose-400">unrestricted</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Missing or invalid settings.json</p>
          {data.customModeIssues.length === 0 ? (
            <p className="text-xs text-muted-foreground mt-1">No issues.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {data.customModeIssues.map(a => (
                <li key={a.id} className="rounded-md border px-3 py-2">
                  <div className="flex items-center justify-between">
                    <a href={`/agents/${a.id}`} className="text-sm font-medium hover:underline">{a.name}</a>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400">{a.mode}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{a.error}</p>
                  <p className="text-[10px] text-muted-foreground font-mono mt-0.5 break-all">{a.settingsJsonPath}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Workspace collisions</p>
          {data.workspaceCollisions.length === 0 ? (
            <p className="text-xs text-muted-foreground mt-1">No two agents share a workspace directory.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {data.workspaceCollisions.map(c => (
                <li key={c.slug} className="rounded-md border px-3 py-2">
                  <p className="text-xs font-mono text-muted-foreground">~/.harbour/workspaces/{c.slug}/</p>
                  <p className="text-xs mt-0.5">
                    Shared by {c.agents.map((a, i) => (
                      <span key={a.id}>
                        {i > 0 && ", "}
                        <a href={`/agents/${a.id}`} className="font-medium hover:underline">{a.name}</a>
                      </span>
                    ))}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Rename one of these agents to give it its own working tree.</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Excessive permissions in safe mode</p>
          {(data.excessivePermissions?.length ?? 0) === 0 ? (
            <p className="text-xs text-muted-foreground mt-1">No safe-mode agents have shell or env-var access enabled.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {data.excessivePermissions!.map(a => (
                <li key={a.id} className="rounded-md border px-3 py-2">
                  <div className="flex items-center justify-between">
                    <a href={`/agents/${a.id}`} className="text-sm font-medium hover:underline">{a.name}</a>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400">{a.mode}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {a.mode} mode normally denies these, but the following are enabled: {a.flags.map(f => <code key={f} className="bg-muted px-1 rounded mr-1">{f}</code>)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">API agents missing update_status</p>
          {(data.apiAgentsWithoutStatus?.length ?? 0) === 0 ? (
            <p className="text-xs text-muted-foreground mt-1">No API agents are missing the update_status tool.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {data.apiAgentsWithoutStatus!.map(a => (
                <li key={a.id} className="rounded-md border px-3 py-2">
                  <a href={`/agents/${a.id}`} className="text-sm font-medium hover:underline">{a.name}</a>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    This API agent cannot mark its own runs as done — runs will sit in &lsquo;running&rsquo; until the per-job timeout fires. Enable <code className="bg-muted px-1 rounded">update_status</code> in tool permissions to fix.
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Env vars attached to jobs</p>
          <p className="text-xs text-muted-foreground mt-1">
            {data.jobEnvVars.count === 0
              ? "No env vars currently attached to any job."
              : `${data.jobEnvVars.count} job–env-var attachment${data.jobEnvVars.count === 1 ? "" : "s"}. Decrypted values are injected into runs at execution time.`}
          </p>
        </div>

        {allClear && data.jobEnvVars.count === 0 && (
          <p className="text-xs text-emerald-700 dark:text-emerald-400">No security issues detected.</p>
        )}
      </div>
    </div>
  );
}
