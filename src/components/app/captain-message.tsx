"use client";

import { useState, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronDown, ChevronRight, Loader2, Check } from "lucide-react";

type OutputEvent = {
  id: number;
  event_type: string;
  content: string | null;
  tool_name: string | null;
};

function ToolBlock({ name, input, output, active }: { name: string; input: string | null; output: string | null; active: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-1.5 rounded border border-border bg-muted/50 text-xs font-mono">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 w-full px-2 py-1.5 text-left hover:bg-muted transition-colors"
      >
        {active ? (
          <Loader2 className="h-3 w-3 text-amber-500 animate-spin shrink-0" />
        ) : (
          <Check className="h-3 w-3 text-muted-foreground shrink-0" />
        )}
        <span className="text-amber-600 dark:text-amber-400 font-semibold">{name}</span>
        {input && <span className="text-muted-foreground truncate ml-1">{input.length > 80 ? input.slice(0, 80) + "..." : input}</span>}
        <span className="ml-auto shrink-0">
          {open ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
        </span>
      </button>
      {open && output && (
        <div className="px-2 py-1.5 border-t border-border text-muted-foreground whitespace-pre-wrap max-h-40 overflow-y-auto">
          {output.length > 500 ? output.slice(0, 500) + "..." : output}
        </div>
      )}
    </div>
  );
}

export function StreamingOutput({ events, streaming }: { events: OutputEvent[]; streaming: boolean }) {
  // Build segments: consecutive text_delta events are merged into markdown blocks,
  // tool_start/tool_end are rendered as collapsible tool blocks between them.
  const segments = useMemo(() => {
    const result: React.ReactNode[] = [];
    let textBuffer = "";
    let textKey = 0;

    function flushText() {
      if (textBuffer) {
        result.push(
          <div key={`text-${textKey++}`} className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{textBuffer}</ReactMarkdown>
          </div>
        );
        textBuffer = "";
      }
    }

    let i = 0;
    while (i < events.length) {
      const evt = events[i];

      if (evt.event_type === "text_delta") {
        textBuffer += evt.content || "";
      } else if (evt.event_type === "thinking") {
        // Skip thinking — noise in chat context
      } else if (evt.event_type === "tool_start") {
        flushText();
        // Look ahead for matching tool_end
        const toolEnd = events.find(
          (e, j) => j > i && e.event_type === "tool_end"
        );
        const isActive = !toolEnd && streaming;
        result.push(
          <ToolBlock
            key={`tool-${evt.id}`}
            name={evt.tool_name || "Tool"}
            input={evt.content}
            output={toolEnd?.content || null}
            active={isActive}
          />
        );
        if (toolEnd) {
          i = events.indexOf(toolEnd);
        }
      } else if (evt.event_type === "tool_end") {
        // Already handled by tool_start pairing
      } else if (evt.event_type === "info") {
        flushText();
        result.push(
          <div key={`info-${evt.id}`} className="text-xs text-muted-foreground my-1">{evt.content}</div>
        );
      } else if (evt.event_type === "result") {
        flushText();
        result.push(
          <div key={`result-${evt.id}`} className="text-xs text-muted-foreground mt-2 pt-1.5 border-t border-border">{evt.content}</div>
        );
      } else if (evt.event_type === "error") {
        flushText();
        result.push(
          <div key={`error-${evt.id}`} className="text-xs text-red-500 mt-1">{evt.content}</div>
        );
      }

      i++;
    }

    flushText();
    return result;
  }, [events, streaming]);

  return <div className="text-sm">{segments}</div>;
}
