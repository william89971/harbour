"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BackLink } from "@/components/app/back-link";
import { Pencil, Save, X, Trash2, History } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { timeAgo } from "@/lib/time";
import { EmptyState } from "@/components/app/empty-state";

type Doc = {
  id: string; title: string;
  content: string; created_at: number; updated_at: number;
};

type Revision = {
  id: string; content: string; author_type: string; author_id: string;
  created_at: number;
};

export default function DocDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(searchParams.get("edit") === "1");
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [showRevisions, setShowRevisions] = useState(false);
  const [revisions, setRevisions] = useState<Revision[]>([]);

  const loadDoc = useCallback(async () => {
    const res = await fetch(`/api/docs/${id}`);
    if (res.ok) {
      const d = await res.json();
      setDoc(d);
      setEditTitle(d.title);
      setEditContent(d.content || "");
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { loadDoc(); }, [loadDoc]);

  async function handleSave() {
    setSaving(true);
    await fetch(`/api/docs/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: editTitle, content: editContent }),
    });
    setSaving(false);
    setEditing(false);
    loadDoc();
  }

  async function handleDelete() {
    if (!confirm(`Delete "${doc?.title}"?`)) return;
    await fetch(`/api/docs/${id}`, { method: "DELETE" });
    router.push("/docs");
  }

  async function loadRevisions() {
    const res = await fetch(`/api/docs/${id}/revisions`);
    if (res.ok) setRevisions(await res.json());
    setShowRevisions(true);
  }

  if (loading) return <div className="text-sm text-muted-foreground py-12 text-center">Loading...</div>;
  if (!doc) return <div className="text-sm text-muted-foreground py-12 text-center">Doc not found.</div>;

  return (
    <div className="space-y-6">
      <BackLink href="/docs" label="Docs" />

      <div className="flex items-start justify-between gap-4">
        {editing ? (
          <Input value={editTitle} onChange={e => setEditTitle(e.target.value)} className="text-xl font-semibold" />
        ) : (
          <h1 className="text-xl font-semibold tracking-tight">{doc.title}</h1>
        )}
        <div className="flex gap-1.5">
          {editing ? (
            <>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditing(false); setEditTitle(doc.title); setEditContent(doc.content || ""); }}>
                <X className="h-3.5 w-3.5" />
              </Button>
              <Button size="icon" className="h-8 w-8" onClick={handleSave} disabled={saving}>
                <Save className="h-3.5 w-3.5" />
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={loadRevisions} title="Revisions">
                <History className="h-3.5 w-3.5" />
              </Button>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setEditing(true)} title="Edit">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleDelete} title="Delete">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>

      {editing ? (
        <Textarea
          value={editContent}
          onChange={e => setEditContent(e.target.value)}
          rows={20}
          className="font-mono text-sm"
          placeholder="Write markdown content..."
        />
      ) : doc.content ? (
        <div className="prose prose-sm dark:prose-invert max-w-none rounded-lg border p-6 bg-card">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.content}</ReactMarkdown>
        </div>
      ) : (
        <EmptyState>No content yet. Click edit to add some.</EmptyState>
      )}

      <Dialog open={showRevisions} onOpenChange={setShowRevisions}>
        <DialogContent className="max-w-lg max-h-[70vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Revision History</DialogTitle></DialogHeader>
          {revisions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No revisions.</p>
          ) : (
            <div className="space-y-3">
              {revisions.map((rev, i) => (
                <div key={rev.id} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium">{rev.author_type} {i === 0 ? "(latest)" : ""}</span>
                    <span className="text-xs text-muted-foreground">{timeAgo(rev.created_at)}</span>
                  </div>
                  <pre className="text-xs bg-muted rounded p-2 overflow-auto max-h-32 whitespace-pre-wrap">{rev.content}</pre>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
