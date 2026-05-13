import { withUserAuth } from "@/lib/auth";
import { getConversationAsync, listCaptainOutputAsync } from "@/lib/db/captain";
import { isRunning } from "@/lib/captain/process-manager";

export const dynamic = "force-dynamic";

export const GET = withUserAuth(async (req, auth, { params }) => {
  const { id } = await params;
  const conversation = await getConversationAsync(id);
  if (!conversation || conversation.user_id !== auth.userId) {
    return new Response("Not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  let lastId = parseInt(req.nextUrl.searchParams.get("after") || "0", 10);
  const messageId = req.nextUrl.searchParams.get("messageId") || undefined;
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          closed = true;
        }
      };

      const poll = async () => {
        if (closed) return;
        try {
          const events = await listCaptainOutputAsync(id, lastId, messageId);
          for (const evt of events) {
            send("output", evt);
            if (evt.id > lastId) lastId = evt.id;
          }

          // If process is no longer running, flush and close
          if (!isRunning(id)) {
            // One final poll to catch any remaining events
            const remaining = await listCaptainOutputAsync(id, lastId, messageId);
            for (const evt of remaining) {
              send("output", evt);
            }
            send("done", {});
            try {
              controller.close();
            } catch {
              /* already closed */
            }
            closed = true;
            return;
          }
        } catch {
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
          return;
        }

        if (!closed) setTimeout(() => { poll(); }, 300);
      };

      poll();
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
});
