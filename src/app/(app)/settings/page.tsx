"use client";

import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Settings as SettingsIcon } from "lucide-react";

type Settings = Record<string, string>;

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [tzSearch, setTzSearch] = useState("");
  const [tzOpen, setTzOpen] = useState(false);

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

  const filteredTimezones = useMemo(() => {
    if (!tzSearch) return timezones;
    const lower = tzSearch.toLowerCase();
    return timezones.filter(tz => tz.toLowerCase().includes(lower));
  }, [timezones, tzSearch]);

  async function updateSetting(key: string, value: string) {
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: value }),
    });
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
      </div>
    </div>
  );
}
