import { NextRequest } from "next/server";
import {
  fetchRemoteProjectJobState,
  getAgentJob,
  type JobSubscriber,
} from "@/lib/agent-runner";
import type { AgentStreamEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_REMOTE_POLL_MS = 50_000; // Rotate SSE gracefully before serverless gateway timeouts

function mapRemoteStatus(
  status: string
): "running" | "done" | "error" | "aborted" {
  if (status === "running" || status === "stop_requested") return "running";
  if (status === "aborted") return "aborted";
  if (status === "error") return "error";
  return "done";
}

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId")?.trim() || "";
  if (!projectId) {
    return new Response(JSON.stringify({ error: "Missing projectId" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const localJob = getAgentJob(projectId);

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let pingTimer: ReturnType<typeof setInterval> | null = null;
      let pollTimer: ReturnType<typeof setInterval> | null = null;
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
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
        if (localJob && subscriber) {
          localJob.subscribers.delete(subscriber);
          subscriber = null;
        }
        try {
          controller.close();
        } catch {
          // ignore
        }
      };

      req.signal.addEventListener("abort", cleanup, { once: true });

      // 1. Same-instance fast path (0ms real-time memory stream)
      if (localJob) {
        sendEvent({
          type: "job_snapshot",
          jobId: localJob.jobId,
          status: localJob.status,
          project: localJob.projectState,
        });

        if (localJob.status !== "running") {
          cleanup();
          return;
        }

        subscriber = (event: AgentStreamEvent) => {
          sendEvent(event);
          if (event.type === "done" || event.type === "error") {
            cleanup();
          }
        };
        localJob.subscribers.add(subscriber);

        pingTimer = setInterval(() => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            cleanup();
          }
        }, 15_000);
        return;
      }

      // 2. Cross-instance Vercel Serverless path (reads live state from Supabase)
      const initialRemote = await fetchRemoteProjectJobState(projectId);
      if (closed) return;

      if (!initialRemote || initialRemote.agentStatus === "idle") {
        sendEvent({ type: "idle" });
        cleanup();
        return;
      }

      const initialMapped = mapRemoteStatus(initialRemote.agentStatus);
      sendEvent({
        type: "job_snapshot",
        jobId: initialRemote.agentJobId || `remote_${projectId}`,
        status: initialMapped,
        project: initialRemote.project,
      });

      if (initialMapped !== "running") {
        cleanup();
        return;
      }

      const startedAt = Date.now();
      let lastSignature = `${initialRemote.agentStatus}:${initialRemote.agentUpdatedAt}:${JSON.stringify(
        initialRemote.project.messages.slice(-1)
      ).length}:${Object.keys(initialRemote.project.files).length}`;

      let polling = false;
      pollTimer = setInterval(async () => {
        if (closed || polling) return;
        if (Date.now() - startedAt > MAX_REMOTE_POLL_MS) {
          // Close cleanly; client auto-reconnects seamlessly while status === 'running'
          cleanup();
          return;
        }

        polling = true;
        try {
          const nextRemote = await fetchRemoteProjectJobState(projectId);
          if (closed) return;

          if (!nextRemote) {
            sendEvent({ type: "idle" });
            cleanup();
            return;
          }

          const mapped = mapRemoteStatus(nextRemote.agentStatus);
          const nextSig = `${nextRemote.agentStatus}:${nextRemote.agentUpdatedAt}:${JSON.stringify(
            nextRemote.project.messages.slice(-1)
          ).length}:${Object.keys(nextRemote.project.files).length}`;

          if (nextSig !== lastSignature || mapped !== "running") {
            lastSignature = nextSig;
            sendEvent({
              type: "job_snapshot",
              jobId: nextRemote.agentJobId || `remote_${projectId}`,
              status: mapped,
              project: nextRemote.project,
            });
          } else {
            controller.enqueue(encoder.encode(": ping\n\n"));
          }

          if (mapped !== "running") {
            cleanup();
          }
        } catch {
          // transient poll failure; retry next tick
        } finally {
          polling = false;
        }
      }, 1000);
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
