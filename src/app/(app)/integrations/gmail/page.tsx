"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Mail, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/app/empty-state";

type GmailPublicConfig = {
  clientIdEnvVarName: string;
  clientSecretEnvVarName: string;
  refreshTokenEnvVarName: string;
  fromEmail: string;
  configured: boolean;
  tokenConfigured: boolean;
};

export default function GmailIntegrationPage() {
  const { data, isLoading } = useQuery<GmailPublicConfig | null>({
    queryKey: ["gmail-config"],
    queryFn: async () => {
      const r = await fetch("/api/integrations/gmail/config");
      if (!r.ok) return null;
      return r.json();
    },
  });

  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [testing, setTesting] = useState(false);

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await fetch("/api/integrations/gmail/test", { method: "POST" });
      const j = await r.json();
      setTestResult(j);
    } finally {
      setTesting(false);
    }
  }

  if (isLoading || !data) return <div className="text-sm text-muted-foreground py-12 text-center">Loading...</div>;

  if (!data.configured) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Mail className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">Gmail</h1>
        </div>
        <EmptyState large icon={<Mail className="h-10 w-10 text-muted-foreground/40" />}>
          Gmail is not configured. Open{" "}
          <Link href="/settings" className="text-primary underline">Settings → Gmail</Link>{" "}
          to set the OAuth env vars and from address.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3 flex-wrap">
        <Mail className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold tracking-tight">Gmail</h1>
        <span className="text-sm text-muted-foreground">Configured · sending as {data.fromEmail}</span>
      </div>

      <section className="rounded-lg border p-4 space-y-3">
        <div className="text-sm">
          OAuth env vars (encrypted in <Link href="/env-vars" className="underline">Env Vars</Link>):
          <ul className="mt-2 space-y-1 text-xs font-mono text-muted-foreground">
            <li>client_id ← {data.clientIdEnvVarName}</li>
            <li>client_secret ← {data.clientSecretEnvVarName}</li>
            <li>refresh_token ← {data.refreshTokenEnvVarName}</li>
          </ul>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleTest} disabled={testing}>
            {testing ? "Testing..." : "Test connection"}
          </Button>
          {testResult && testResult.ok && (
            <span className="text-xs text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> Connected
            </span>
          )}
          {testResult && !testResult.ok && (
            <span className="text-xs text-rose-700 dark:text-rose-400 inline-flex items-center gap-1">
              <XCircle className="h-3.5 w-3.5" /> {testResult.error ?? "Failed"}
            </span>
          )}
        </div>
      </section>

      <section className="rounded-lg border p-4 space-y-2 text-sm text-muted-foreground">
        <p>Harbour creates drafts only. To send, open Gmail and finalize manually.</p>
        <p>
          To send a draft via Gmail, go to{" "}
          <Link href="/outreach" className="underline">Outreach</Link>{" "}
          and click <em>Create Gmail draft</em> on an approved outreach row.
        </p>
        <a
          href="https://mail.google.com/mail/u/0/#drafts"
          target="_blank"
          rel="noreferrer"
          className="text-xs text-primary inline-flex items-center gap-1 hover:underline"
        >
          Open Gmail drafts <ExternalLink className="h-3 w-3" />
        </a>
      </section>
    </div>
  );
}
