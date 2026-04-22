"use client";

import { useState, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronDown, ChevronRight, Loader2, Check, Wrench } from "lucide-react";

type OutputEvent = {
  id: number;
  event_type: string;
  content: string | null;
  tool_name: string | null;
};

// ── Single tool block ──────────────────────────────────────────────────

function ToolBlock({
  name,
  input,
  output,
  active,
  defaultOpen = false,
}: {
  name: string;
  input: string | null;
  output: string | null;
  active: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  // Build a one-line preview of the output
  const outputPreview = useMemo(() => {
    if (!output) return null;
    const firstLine = output.split("\n").find((l) => l.trim()) || "";
    return firstLine.length > 120 ? firstLine.slice(0, 120) + "..." : firstLine;
  }, [output]);

  return (
    <div className="rounded border border-border bg-muted/30 text-xs font-mono overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 w-full px-2.5 py-1.5 text-left hover:bg-muted/50 transition-colors"
      >
        {active ? (
          <Loader2 className="h-3 w-3 text-amber-500 animate-spin shrink-0" />
        ) : (
          <Check className="h-3 w-3 text-emerald-500 shrink-0" />
        )}
        <span className="text-foreground font-semibold shrink-0">{name}</span>
        {input && (
          <span className="text-muted-foreground truncate">
            {input.length > 80 ? input.slice(0, 80) + "..." : input}
          </span>
        )}
        <span className="ml-auto shrink-0 text-muted-foreground">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
      </button>
      {!open && outputPreview && (
        <div className="px-2.5 pb-1.5 text-muted-foreground/70 truncate">
          {outputPreview}
        </div>
      )}
      {open && output && (
        <div className="px-2.5 py-2 border-t border-border text-muted-foreground whitespace-pre-wrap max-h-60 overflow-y-auto">
          {output}
        </div>
      )}
    </div>
  );
}

// ── Tool call list for finalized messages ───────────────────────────────

export function ToolCallList({ toolEvents }: { toolEvents: OutputEvent[] }) {
  const [collapsed, setCollapsed] = useState(true);

  const toolPairs = useMemo(() => {
    const pairs: { name: string; input: string | null; output: string | null }[] = [];
    let i = 0;
    while (i < toolEvents.length) {
      const evt = toolEvents[i];
      if (evt.event_type === "tool_start") {
        // Find matching tool_end
        const endIdx = toolEvents.findIndex(
          (e, j) => j > i && e.event_type === "tool_end"
        );
        pairs.push({
          name: evt.tool_name || "Tool",
          input: evt.content,
          output: endIdx >= 0 ? toolEvents[endIdx].content : null,
        });
        if (endIdx >= 0) i = endIdx + 1;
        else i++;
      } else {
        i++;
      }
    }
    return pairs;
  }, [toolEvents]);

  if (toolPairs.length === 0) return null;

  return (
    <div className="mt-3">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-1.5"
      >
        <Wrench className="h-3 w-3" />
        <span>{toolPairs.length} tool call{toolPairs.length !== 1 ? "s" : ""}</span>
        {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {!collapsed && (
        <div className="space-y-1">
          {toolPairs.map((pair, idx) => (
            <ToolBlock
              key={idx}
              name={pair.name}
              input={pair.input}
              output={pair.output}
              active={false}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Streaming output ────────────────────────────────────────────────────

export function StreamingOutput({
  events,
  streaming,
}: {
  events: OutputEvent[];
  streaming: boolean;
}) {
  const { textContent, toolBlocks } = useMemo(() => {
    let text = "";
    const tools: {
      id: number;
      name: string;
      input: string | null;
      output: string | null;
      active: boolean;
    }[] = [];

    let i = 0;
    while (i < events.length) {
      const evt = events[i];
      if (evt.event_type === "text_delta") {
        text += evt.content || "";
      } else if (evt.event_type === "tool_start") {
        // Find matching tool_end
        const endIdx = events.findIndex(
          (e, j) => j > i && e.event_type === "tool_end"
        );
        const hasEnd = endIdx >= 0;
        tools.push({
          id: evt.id,
          name: evt.tool_name || "Tool",
          input: evt.content,
          output: hasEnd ? events[endIdx].content : null,
          active: !hasEnd && streaming,
        });
        if (hasEnd) i = endIdx;
      }
      // Skip thinking, tool_end (handled above), info, result, error handled below
      i++;
    }

    return { textContent: text, toolBlocks: tools };
  }, [events, streaming]);

  const errorEvents = events.filter((e) => e.event_type === "error");

  return (
    <div className="text-sm">
      {/* Text content rendered as markdown */}
      {textContent && (
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{textContent}</ReactMarkdown>
        </div>
      )}

      {/* Errors only — info/result are noise in chat context */}
      {errorEvents.map((evt) => (
        <div key={evt.id} className="text-xs text-red-500 mt-1">
          {evt.content}
        </div>
      ))}

      {/* Tool blocks pushed to bottom */}
      {toolBlocks.length > 0 && (
        <div className="mt-3 space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
            <Wrench className="h-3 w-3" />
            <span>
              {toolBlocks.filter((t) => !t.active).length}/{toolBlocks.length} tool call
              {toolBlocks.length !== 1 ? "s" : ""}
            </span>
          </div>
          {toolBlocks.map((tool) => (
            <ToolBlock
              key={tool.id}
              name={tool.name}
              input={tool.input}
              output={tool.output}
              active={tool.active}
            />
          ))}
        </div>
      )}
    </div>
  );
}
