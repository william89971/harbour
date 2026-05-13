"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { User, Trash2 } from "lucide-react";
import { timeAgo } from "@/lib/time";
import { EmptyState } from "@/components/app/empty-state";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import type { UserRole } from "@/lib/permissions";
import { Button } from "@/components/ui/button";

type UserType = { id: string; email: string; display_name: string; role: UserRole; created_at: number };

const ROLES: UserRole[] = ["admin", "operator", "viewer"];
const ROLE_STYLES: Record<UserRole, string> = {
  admin: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  operator: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  viewer: "bg-muted text-muted-foreground",
};

export default function UsersPage() {
  const queryClient = useQueryClient();
  const { isAdmin, user: currentUser } = useCurrentUser();

  const { data: users = [], isLoading: loading } = useQuery<UserType[]>({
    queryKey: ["users"],
    queryFn: async () => {
      const res = await fetch("/api/users");
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 5000,
  });

  async function changeRole(userId: string, role: UserRole) {
    const res = await fetch(`/api/users/${userId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to update role" }));
      alert(err.error || "Failed to update role");
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["users"] });
  }

  async function deleteUser(userId: string, email: string) {
    if (!confirm(`Delete user ${email}? This cannot be undone.`)) return;
    const res = await fetch(`/api/users/${userId}`, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to delete user" }));
      alert(err.error || "Failed to delete user");
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["users"] });
  }

  if (loading) return <div className="text-sm text-muted-foreground py-12 text-center">Loading...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground mt-1">Dashboard accounts.</p>
      </div>

      {users.length === 0 ? (
        <EmptyState>No users.</EmptyState>
      ) : (
        <div className="space-y-2">
          {users.map(user => (
            <div key={user.id} className="flex items-start gap-3 rounded-lg border p-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                <User className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{user.display_name}</div>
                <div className="text-xs text-muted-foreground">{user.email}</div>
              </div>
              {isAdmin ? (
                <div className="flex items-center gap-2">
                  <select
                    value={user.role}
                    onChange={e => changeRole(user.id, e.target.value as UserRole)}
                    className="text-xs px-2 py-1 rounded border bg-background"
                  >
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => deleteUser(user.id, user.email)}
                    disabled={user.id === currentUser?.id}
                    title={user.id === currentUser?.id ? "Cannot delete yourself" : "Delete user"}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${ROLE_STYLES[user.role] || ""}`}>
                  {user.role}
                </span>
              )}
              <span className="text-xs text-muted-foreground pt-1">Joined {timeAgo(user.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
