"use client";

import { Label } from "@/components/ui/label";
import type { ToolName, ToolPermissions } from "@/lib/db/agents";

type ToolMeta = { name: ToolName; label: string; description: string };

const TOOL_META: ToolMeta[] = [
  { name: "read_docs",        label: "Read docs",        description: "GET /api/docs and /api/docs/:id" },
  { name: "write_docs",       label: "Write docs",       description: "POST /api/docs, PUT /api/docs/:id, DELETE /api/docs/:id" },
  { name: "read_databases",   label: "Read databases",   description: "GET /api/databases and /api/databases/:id/rows" },
  { name: "write_databases",  label: "Write databases",  description: "POST /api/databases and /api/databases/:id/rows" },
  { name: "read_env_vars",    label: "Read env vars",    description: "Read job-linked environment variables from inside the agent process (api agents only)" },
  { name: "create_runs",      label: "Create runs",      description: "POST /api/runs — schedule one-off runs" },
  { name: "create_handoffs",  label: "Create handoffs",  description: "POST /api/runs/:id/handoff — pass control to another agent or team" },
  { name: "post_activity",    label: "Post activity",    description: "POST /api/runs/:id/activity — narrate progress on the run" },
  { name: "update_status",    label: "Update status",    description: "PUT /api/runs/:id/status — set done/failed/waiting" },
  { name: "use_shell",        label: "Use shell",        description: "Whether the agent's CLI is permitted to spawn shell subprocesses (informational for shell-capable providers; api agents always have this off)" },
];

/** Editable grid of the ten tool permissions. The component is provider-
 *  agnostic — `cli` only changes the wording on the use_shell row. */
export function ToolPermissionsEditor({
  cli,
  value,
  onChange,
  disabled,
}: {
  cli: string | null;
  value: ToolPermissions;
  onChange: (next: ToolPermissions) => void;
  disabled?: boolean;
}) {
  const isApi = cli === "api";
  return (
    <div className="space-y-2">
      <Label>Tool permissions</Label>
      <p className="text-xs text-muted-foreground">
        Per-endpoint server-side gates. Calls to denied endpoints return 403. For API agents these also define which functions the model can see in its tool spec.
      </p>
      <div className="grid gap-1 rounded-md border p-2">
        {TOOL_META.map(t => {
          const checked = !!value[t.name];
          const lockedOff = isApi && t.name === "use_shell";
          return (
            <label
              key={t.name}
              className={`flex items-start gap-3 rounded p-2 ${disabled || lockedOff ? "opacity-60" : "hover:bg-muted/50"} cursor-pointer`}
              title={lockedOff ? "API agents never have shell access" : undefined}
            >
              <input
                type="checkbox"
                checked={checked && !lockedOff}
                onChange={e => onChange({ ...value, [t.name]: e.target.checked })}
                disabled={disabled || lockedOff}
                className="mt-1"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{t.label}</div>
                <div className="text-xs text-muted-foreground">{t.description}</div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}
