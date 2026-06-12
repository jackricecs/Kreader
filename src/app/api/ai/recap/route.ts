// 前情提要 —— 无剧透，只复述已读内容。

import { providerFor } from "@/lib/ai";
import { buildRecapPrompt } from "@/lib/ai/prompts";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let parsed: { readContext?: string; provider?: "qwen" | "deepseek" | "custom" };
  try {
    parsed = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "请求体不是合法 JSON" }), { status: 400 });
  }
  const { readContext = "", provider } = parsed;

  if (!readContext.trim()) {
    return new Response(JSON.stringify({ error: "缺少 readContext" }), { status: 400 });
  }

  const ai = providerFor("recap", provider);
  const messages = buildRecapPrompt(readContext);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      try {
        for await (const token of ai.stream(messages, { temperature: 0.5 })) {
          controller.enqueue(enc.encode(token));
        }
      } catch (e) {
        controller.enqueue(enc.encode(`\n[提要失败] ${(e as Error).message}`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
