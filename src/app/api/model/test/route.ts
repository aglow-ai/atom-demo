import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function shouldUseResponsesApi(provider: string | undefined, baseUrl: string): boolean {
  const lower = baseUrl.toLowerCase();
  if (lower.endsWith("/responses")) return true;
  if (lower.endsWith("/chat/completions")) return false;
  return provider === "openai" || lower.includes("api.openai.com");
}

function buildResponsesUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/responses")) return trimmed;
  return `${trimmed}/responses`;
}

function buildChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
}

async function parseErrorDetail(res: Response): Promise<string> {
  const errText = await res.text().catch(() => "");
  try {
    const parsed = JSON.parse(errText);
    return String(parsed?.error?.message || parsed?.message || errText);
  } catch {
    return errText;
  }
}

function extractResponsesText(data: Record<string, unknown>): string {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }
  const output = data.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      if (
        item &&
        typeof item === "object" &&
        (item as { type?: string }).type === "message" &&
        Array.isArray((item as { content?: unknown[] }).content)
      ) {
        for (const part of (item as { content: Array<{ text?: string }> }).content) {
          if (typeof part?.text === "string" && part.text.trim()) {
            return part.text.trim();
          }
        }
      }
    }
  }
  return "OK";
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      provider?: string;
      baseUrl?: string;
      apiKey?: string;
      model?: string;
    };

    const provider = body.provider?.trim();
    const baseUrl = body.baseUrl?.trim() || "";
    const apiKey = body.apiKey?.trim() || "";
    const model = body.model?.trim() || "";

    if (!baseUrl || !apiKey || !model) {
      return NextResponse.json(
        { ok: false, error: "请完整填写 Base URL、API Key 和模型名称。" },
        { status: 400 }
      );
    }

    const useResponses = shouldUseResponsesApi(provider, baseUrl);
    const start = Date.now();

    const doRequest = (endpoint: string, payload: Record<string, unknown>) =>
      fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(25000),
      });

    if (useResponses) {
      const endpoint = buildResponsesUrl(baseUrl);
      const upstream = await doRequest(endpoint, {
        model,
        input: "Reply with OK only.",
        max_output_tokens: 64,
        store: false,
      });

      const latencyMs = Date.now() - start;
      if (!upstream.ok) {
        const detail = await parseErrorDetail(upstream);
        return NextResponse.json(
          {
            ok: false,
            status: upstream.status,
            latencyMs,
            error: `请求失败 (HTTP ${upstream.status}): ${detail.slice(0, 300)}`,
          },
          { status: 200 }
        );
      }

      const data = (await upstream.json()) as Record<string, unknown>;
      return NextResponse.json({
        ok: true,
        latencyMs,
        model: String(data.model || model),
        reply: extractResponsesText(data).slice(0, 80),
      });
    }

    // Chat Completions API for non-OpenAI compatible providers
    const endpoint = buildChatCompletionsUrl(baseUrl);
    const baseMessages = [{ role: "user", content: "Reply with OK only." }];

    let upstream = await doRequest(endpoint, {
      model,
      messages: baseMessages,
      max_completion_tokens: 64,
    });

    if (!upstream.ok && upstream.status === 400) {
      const detail = await parseErrorDetail(upstream);
      if (detail.includes("max_completion_tokens")) {
        upstream = await doRequest(endpoint, {
          model,
          messages: baseMessages,
          max_tokens: 64,
        });
      } else {
        const latencyMs = Date.now() - start;
        return NextResponse.json(
          {
            ok: false,
            status: upstream.status,
            latencyMs,
            error: `请求失败 (HTTP ${upstream.status}): ${detail.slice(0, 300)}`,
          },
          { status: 200 }
        );
      }
    }

    const latencyMs = Date.now() - start;
    if (!upstream.ok) {
      const detail = await parseErrorDetail(upstream);
      return NextResponse.json(
        {
          ok: false,
          status: upstream.status,
          latencyMs,
          error: `请求失败 (HTTP ${upstream.status}): ${detail.slice(0, 300)}`,
        },
        { status: 200 }
      );
    }

    const data = await upstream.json();
    const reply = data?.choices?.[0]?.message?.content ?? "OK";

    return NextResponse.json({
      ok: true,
      latencyMs,
      model: data?.model || model,
      reply: String(reply).trim().slice(0, 80),
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? `连接异常: ${err.message}`
            : "连接测试失败，请检查网络与接口地址。",
      },
      { status: 200 }
    );
  }
}
