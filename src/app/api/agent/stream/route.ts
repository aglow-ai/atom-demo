import { NextRequest } from "next/server";
import { getAgentJob, type JobSubscriber } from "@/lib/agent-runner";
import type { AgentStreamEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId")?.trim() || "";
  if (!projectId) {
    return new Response(JSON.stringify({ error: "Missing projectId" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const job = getAgentJob(projectId);

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let pingTimer: ReturnType<typeof setInterval> | null = null;
      let subscriber: JobSubscriber | null = null;

      const sendEvent = (event: AgentStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
        } catch {
          cleanup();
        }
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (pingTimer) {
          clearInterval(pingTimer);
          pingTimer = null;
        }
        if (job && subscriber) {
          job.subscribers.delete(subscriber);
          subscriber = null;
        }
        try {
          controller.close();
        } catch {
          // ignore
        }
      };

      if (!job) {
        sendEvent({ type: "idle" });
        cleanup();
        return;
      }

      // Immediately push authoritative live snapshot so refreshed tabs catch up cleanly
      sendEvent({
        type: "job_snapshot",
        jobId: job.jobId,
        status: job.status,
        project: job.projectState,
      });

      if (job.status !== "running") {
        cleanup();
        return;
      }

      subscriber = (event: AgentStreamEvent) => {
        sendEvent(event);
        if (event.type === "done" || event.type === "error") {
          cleanup();
        }
      };
      job.subscribers.add(subscriber);

      // Keep-alive ping every 15s while waiting on long model reasoning steps
      pingTimer = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          cleanup();
        }
      }, 15_000);

      // Client disconnect ONLY detaches subscriber — background job keeps running!
      req.signal.addEventListener("abort", cleanup, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
