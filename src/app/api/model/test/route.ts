import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function buildChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) {
    return trimmed;
  }
  return `${trimmed}/chat/completions`;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      baseUrl?: string;
      apiKey?: string;
      model?: string;
    };

    const baseUrl = body.baseUrl?.trim() || "";
    const apiKey = body.apiKey?.trim() || "";
    const model = body.model?.trim() || "";

    if (!baseUrl || !apiKey || !model) {
      return NextResponse.json(
        { ok: false, error: "请完整填写 Base URL、API Key 和模型名称。" },
        { status: 400 }
      );
    }

    const endpoint = buildChatCompletionsUrl(baseUrl);
    const start = Date.now();

    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with OK only." }],
        max_tokens: 12,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(20000),
    });

    const latencyMs = Date.now() - start;

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      let detail = errText;
      try {
        const parsed = JSON.parse(errText);
        detail = parsed?.error?.message || parsed?.message || errText;
      } catch {
        // keep raw text
      }
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
