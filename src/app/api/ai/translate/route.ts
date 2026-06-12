// 段落翻译 —— 流式返回。注入术语表保证全书译名一致。

import { providerFor } from "@/lib/ai";
import { buildTranslatePrompt, type GlossaryEntry } from "@/lib/ai/prompts";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let parsed: {
    text: string;
    glossary?: GlossaryEntry[];
    style?: "literal" | "fluent" | "webnovel";
    provider?: "qwen" | "deepseek" | "custom";
  };
  try {
    parsed = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "请求体不是合法 JSON" }), { status: 400 });
  }
  const { text, glossary = [], style = "fluent", provider } = parsed;

  if (!text?.trim()) {
    return new Response(JSON.stringify({ error: "缺少 text" }), { status: 400 });
  }

  const ai = providerFor("translate", provider);
  const messages = buildTranslatePrompt(text, glossary, style);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        for await (const token of ai.stream(messages, { temperature: 0.3 })) {
          controller.enqueue(encoder.encode(token));
        }
      } catch (e) {
        const err = e as Error & { cause?: { code?: string; message?: string } };
        const cause = err.cause?.code ?? err.cause?.message ?? "";
        console.error("[ai:translate] 调用失败:", err.message, err.cause ?? "");
        controller.enqueue(
          encoder.encode(`\n[翻译失败] ${err.message}${cause ? ` (${cause})` : ""}`),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
