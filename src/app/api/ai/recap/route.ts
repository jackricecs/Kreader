// 前情提要 —— 无剧透，只复述已读内容。带「按进度缓存」：
//   命中（防剧透）：仅当「当前已读 upto >= 缓存 upto」时返回缓存文本，瞬时、零 token。
//   未命中 / force：流式生成，结束后写入缓存。
//   响应头 X-Recap-Cached(1/0) 与 X-Recap-Upto 告诉客户端结果对应的已读位置，用于判断「可更新」。
// 兼容旧用法 {readContext}（无 bookId 则不缓存，示例书用）。

import { prisma } from "@/lib/db";
import { providerFor } from "@/lib/ai";
import { buildRecapPrompt } from "@/lib/ai/prompts";
import type { ProviderId } from "@/lib/ai/types";

export const runtime = "nodejs";

async function readContextUpto(bookId: string, upto: number): Promise<string> {
  const paras = await prisma.paragraph.findMany({
    where: { chapter: { bookId }, globalIndex: { lte: upto } },
    orderBy: { globalIndex: "asc" },
    select: { text: true },
  });
  return paras.map((p) => p.text).join("\n");
}

function textStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

export async function POST(req: Request) {
  let parsed: { bookId?: string; upto?: number; readContext?: string; force?: boolean; provider?: ProviderId };
  try {
    parsed = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "请求体不是合法 JSON" }), { status: 400 });
  }
  const { bookId, upto, readContext, force, provider } = parsed;
  const useCache = !!bookId && Number.isInteger(upto) && (upto as number) >= 0;

  // 1) 命中缓存（防剧透：当前读到的位置不早于缓存生成位置）→ 瞬时返回，不调用模型。
  if (useCache && !force) {
    const cache = await prisma.recapCache.findUnique({ where: { bookId: bookId! } });
    if (cache && (upto as number) >= cache.upto) {
      return new Response(textStream(cache.data), {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "X-Recap-Cached": "1",
          "X-Recap-Upto": String(cache.upto),
        },
      });
    }
  }

  const ctx = useCache ? await readContextUpto(bookId!, upto!) : readContext ?? "";
  if (!ctx.trim()) {
    return new Response(JSON.stringify({ error: "缺少已读内容" }), { status: 400 });
  }

  const ai = providerFor("recap", provider);
  const messages = buildRecapPrompt(ctx);

  // 2) 流式生成；累积全文，结束后写入缓存。
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      let acc = "";
      try {
        for await (const token of ai.stream(messages, { temperature: 0.5 })) {
          acc += token;
          controller.enqueue(enc.encode(token));
        }
        if (useCache && acc.trim()) {
          await prisma.recapCache.upsert({
            where: { bookId: bookId! },
            create: { bookId: bookId!, upto: upto!, data: acc },
            update: { upto: upto!, data: acc },
          });
        }
      } catch (e) {
        controller.enqueue(enc.encode(`\n[提要失败] ${(e as Error).message}`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Recap-Cached": "0",
      "X-Recap-Upto": useCache ? String(upto) : "",
    },
  });
}
