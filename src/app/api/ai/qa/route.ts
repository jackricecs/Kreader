// 剧透安全问答 —— 只用「已读上下文」回答。readContext 必须由调用方按进度截断。

import { providerFor } from "@/lib/ai";
import { buildQaPrompt } from "@/lib/ai/prompts";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let parsed: { question: string; readContext?: string; provider?: "qwen" | "deepseek" | "custom" };
  try {
    parsed = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "请求体不是合法 JSON" }), { status: 400 });
  }
  const { question, readContext = "", provider } = parsed;

  if (!question?.trim()) {
    return new Response(JSON.stringify({ error: "缺少 question" }), { status: 400 });
  }

  const ai = providerFor("qa", provider);
  const messages = buildQaPrompt(question, readContext);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      try {
        for await (const token of ai.stream(messages, { temperature: 0.4 })) {
          controller.enqueue(enc.encode(token));
        }
      } catch (e) {
        controller.enqueue(enc.encode(`\n[问答失败] ${(e as Error).message}`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
