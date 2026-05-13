"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { ACTION_TYPES, RISK_LEVELS, SCOPE_TYPES, type ActionType, type RiskLevel, type ScopeType } from "@/lib/autonomy/constants";

type PolicyRow = {
  id: string;
  name: string;
  description: string | null;
  scope_type: ScopeType;
  scope_id: string | null;
  enabled: number;
  rule_count?: number;
};

type RuleRow = {
  id: string;
  policy_id: string;
  action_type: ActionType;
  risk_level: RiskLevel;
  require_approval: number;
  max_cost_usd: number | null;
};

export function AutonomyPoliciesPanel() {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["autonomy-policies"],
    queryFn: async () => {
      const r = await fetch("/api/autonomy/policies");
      if (!r.ok) throw new Error("failed to load policies");
      return r.json() as Promise<{ policies: PolicyRow[] }>;
    },
  });

  const create = useMutation({
    mutationFn: async (input: { name: string; scope_type: ScopeType; scope_id?: string | null; description?: string }) => {
      const r = await fetch("/api/autonomy/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!r.ok) throw new Error((await r.json()).error || "create failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["autonomy-policies"] });
      setShowNew(false);
    },
  });

  const toggleEnabled = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const r = await fetch(`/api/autonomy/policies/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!r.ok) throw new Error("update failed");
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["autonomy-policies"] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/autonomy/policies/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("delete failed");
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["autonomy-policies"] }),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading policies…</p>;
  const policies = data?.policies ?? [];

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {policies.map(p => (
          <PolicyCard
            key={p.id}
            policy={p}
            expanded={expandedId === p.id}
            onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)}
            onToggleEnabled={() => toggleEnabled.mutate({ id: p.id, enabled: !p.enabled })}
            onDelete={() => {
              if (p.scope_type === "global") return;
              if (confirm(`Delete policy "${p.name}"?`)) remove.mutate(p.id);
            }}
          />
        ))}
        {policies.length === 0 && (
          <p className="text-sm text-muted-foreground">No policies yet.</p>
        )}
      </div>
      <Button variant="outline" size="sm" onClick={() => setShowNew(true)}>
        <Plus className="h-4 w-4 mr-1.5" /> New Policy
      </Button>

      <NewPolicyDialog
        open={showNew}
        onClose={() => setShowNew(false)}
        onCreate={(input) => create.mutate(input)}
        pending={create.isPending}
      />
    </div>
  );
}

function PolicyCard({ policy, expanded, onToggle, onToggleEnabled, onDelete }: {
  policy: PolicyRow;
  expanded: boolean;
  onToggle: () => void;
  onToggleEnabled: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-md border bg-card">
      <div className="flex items-center justify-between p-3">
        <button onClick={onToggle} className="flex items-center gap-2 text-left flex-1 min-w-0">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm truncate">{policy.name}</span>
              <Badge variant="outline">{policy.scope_type}</Badge>
              {policy.scope_id && <Badge variant="secondary">{policy.scope_id}</Badge>}
              {!policy.enabled && <Badge variant="secondary">disabled</Badge>}
            </div>
            {policy.description && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{policy.description}</p>
            )}
          </div>
        </button>
        <div className="flex items-center gap-2 ml-2">
          <Button variant="outline" size="sm" onClick={onToggleEnabled}>
            {policy.enabled ? "Disable" : "Enable"}
          </Button>
          {policy.scope_type !== "global" && (
            <Button variant="outline" size="sm" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
      {expanded && <PolicyRulesEditor policyId={policy.id} />}
    </div>
  );
}

function PolicyRulesEditor({ policyId }: { policyId: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["autonomy-policy-rules", policyId],
    queryFn: async () => {
      const r = await fetch(`/api/autonomy/policies/${policyId}/rules`);
      if (!r.ok) throw new Error("failed to load rules");
      return r.json() as Promise<{ rules: RuleRow[] }>;
    },
  });

  const upsert = useMutation({
    mutationFn: async (rule: { action_type: ActionType; risk_level: RiskLevel; require_approval: boolean; max_cost_usd: number | null }) => {
      const r = await fetch(`/api/autonomy/policies/${policyId}/rules`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action_type: rule.action_type,
          risk_level: rule.risk_level,
          require_approval: !!rule.require_approval,
          max_cost_usd: rule.max_cost_usd ?? null,
        }),
      });
      if (!r.ok) throw new Error("save failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["autonomy-policy-rules", policyId] });
      qc.invalidateQueries({ queryKey: ["autonomy-policies"] });
    },
  });

  const removeRule = useMutation({
    mutationFn: async (action: ActionType) => {
      const r = await fetch(`/api/autonomy/policies/${policyId}/rules`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action_type: action }),
      });
      if (!r.ok) throw new Error("delete failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["autonomy-policy-rules", policyId] });
      qc.invalidateQueries({ queryKey: ["autonomy-policies"] });
    },
  });

  if (isLoading) return <p className="px-3 pb-3 text-xs text-muted-foreground">Loading rules…</p>;
  const ruleByAction = new Map<string, RuleRow>();
  for (const r of data?.rules ?? []) ruleByAction.set(r.action_type, r);

  return (
    <div className="border-t px-3 py-2 space-y-1">
      <div className="grid grid-cols-12 gap-2 text-xs text-muted-foreground px-2">
        <div className="col-span-4">Action</div>
        <div className="col-span-3">Risk</div>
        <div className="col-span-2">Require approval</div>
        <div className="col-span-2">Max $</div>
        <div className="col-span-1" />
      </div>
      {ACTION_TYPES.map(action => {
        const rule = ruleByAction.get(action);
        return (
          <RuleRowEditor
            key={action}
            action={action}
            rule={rule}
            onSave={(r) => upsert.mutate(r)}
            onClear={() => rule && removeRule.mutate(action)}
          />
        );
      })}
    </div>
  );
}

function RuleRowEditor({ action, rule, onSave, onClear }: {
  action: ActionType;
  rule?: RuleRow;
  onSave: (r: { action_type: ActionType; risk_level: RiskLevel; require_approval: boolean; max_cost_usd: number | null }) => void;
  onClear: () => void;
}) {
  const [risk, setRisk] = useState<RiskLevel>(rule?.risk_level ?? "high");
  const [require, setRequire] = useState<boolean>(!!rule?.require_approval);
  const [maxCost, setMaxCost] = useState<string>(rule?.max_cost_usd != null ? String(rule.max_cost_usd) : "");

  const dirty = !rule
    || risk !== rule.risk_level
    || require !== !!rule.require_approval
    || (maxCost === "" ? rule.max_cost_usd != null : Number(maxCost) !== rule.max_cost_usd);

  return (
    <div className="grid grid-cols-12 gap-2 items-center px-2 py-1 rounded hover:bg-muted/50">
      <div className="col-span-4 text-xs font-mono">{action}</div>
      <div className="col-span-3">
        <Select value={risk} onValueChange={(v) => setRisk(v as RiskLevel)}>
          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {RISK_LEVELS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="col-span-2 flex items-center justify-center">
        <input type="checkbox" checked={require} onChange={e => setRequire(e.target.checked)} />
      </div>
      <div className="col-span-2">
        <Input
          type="number"
          step="0.01"
          min="0"
          className="h-7 text-xs"
          placeholder="—"
          value={maxCost}
          onChange={e => setMaxCost(e.target.value)}
        />
      </div>
      <div className="col-span-1 flex gap-1">
        {dirty && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            onClick={() => onSave({
              action_type: action,
              risk_level: risk,
              require_approval: require,
              max_cost_usd: maxCost === "" ? null : Number(maxCost),
            })}
          >
            save
          </Button>
        )}
        {rule && !dirty && (
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={onClear}>
            clear
          </Button>
        )}
      </div>
    </div>
  );
}

function NewPolicyDialog({ open, onClose, onCreate, pending }: {
  open: boolean;
  onClose: () => void;
  onCreate: (input: { name: string; scope_type: ScopeType; scope_id?: string | null; description?: string }) => void;
  pending: boolean;
}) {
  const [name, setName] = useState("");
  const [scopeType, setScopeType] = useState<ScopeType>("department");
  const [scopeId, setScopeId] = useState("");
  const [description, setDescription] = useState("");

  const submit = () => {
    if (!name.trim()) return;
    if (scopeType !== "global" && !scopeId.trim()) return;
    onCreate({
      name: name.trim(),
      scope_type: scopeType,
      scope_id: scopeType === "global" ? null : scopeId.trim(),
      description: description.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { setName(""); setScopeId(""); setDescription(""); onClose(); } }}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Autonomy Policy</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Marketing approvals" />
          </div>
          <div>
            <Label className="text-xs">Scope</Label>
            <Select value={scopeType} onValueChange={(v) => setScopeType(v as ScopeType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SCOPE_TYPES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {scopeType !== "global" && (
            <div>
              <Label className="text-xs">{scopeType === "department" ? "Department name" : `${scopeType} ID`}</Label>
              <Input value={scopeId} onChange={e => setScopeId(e.target.value)} placeholder={scopeType === "department" ? "Marketing" : ""} />
            </div>
          )}
          <div>
            <Label className="text-xs">Description (optional)</Label>
            <Input value={description} onChange={e => setDescription(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button onClick={submit} disabled={pending || !name.trim() || (scopeType !== "global" && !scopeId.trim())}>Create</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
