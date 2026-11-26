import { NextRequest, NextResponse } from "next/server";
import { resolveModelProvider } from "@/lib/providers";
import type { ModelConfig, ModelProviderId } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      provider?: ModelProviderId;
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

    const config: ModelConfig = {
      provider: body.provider || "custom",
      baseUrl,
      apiKey,
      model,
      maxIterations: 12,
    };

    const provider = resolveModelProvider(config);
    const result = await provider.testConnection(config);

    return NextResponse.json(result, { status: 200 });
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
