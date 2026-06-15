// AI 世界观百科：依据「已读上下文」抽取已登场的世界观词条，返回 JSON 数组。
// 非流式（结果是结构化数据，需整体解析）。防剧透由 upto（已读段落上界）保证。
//
// 缓存（每本一份，键 bookId，带生成时的 upto）：
//   GET  ?bookId&upto  → 仅当「当前 upto >= 缓存 upto」时命中（缓存是已读前缀的子集，安全）。
//                        不命中或读得更靠前则返回 {cached:false}，绝不调用模型、绝不泄露未读词条。
//   POST {bookId,upto} → 服务端按 upto 组装上下文、调用模型、写入/覆盖缓存。
//                        兼容 {readContext}（无 bookId，则不缓存）。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { providerFor } from "@/lib/ai";
import { buildEncPrompt } from "@/lib/ai/prompts";
import type { ProviderId } from "@/lib/ai/types";

export const runtime = "nodejs";

interface EncItem { name: string; category: string; desc: string; first: string }

/** 从可能带 ``` 包裹或夹杂文字的输出里，抠出第一个 JSON 数组。 */
function parseEnc(raw: string): EncItem[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  try {
    const arr = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((e: unknown): e is Record<string, unknown> => !!e && typeof e === "object")
      .map((e: Record<string, unknown>) => ({
        name: String(e.name ?? "").trim(),
        category: String(e.category ?? "").trim().slice(0, 6),
        desc: String(e.desc ?? "").trim(),
        first: String(e.first ?? "").trim(),
      }))
      .filter((e: EncItem) => e.name && e.desc);
  } catch {
    return [];
  }
}

/** 服务端按全局段落序组装已读上下文（与 /api/books/[id]/context 同源逻辑）。 */
async function readContextUpto(bookId: string, upto: number): Promise<string> {
  const paras = await prisma.paragraph.findMany({
    where: { chapter: { bookId }, globalIndex: { lte: upto } },
    orderBy: { globalIndex: "asc" },
    select: { text: true },
  });
  return paras.map((p) => p.text).join("\n");
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const bookId = sp.get("bookId");
  const upto = Number(sp.get("upto"));
  if (!bookId || !Number.isInteger(upto) || upto < 0) {
    return NextResponse.json({ error: "缺少 bookId / upto" }, { status: 400 });
  }
  const cache = await prisma.encCache.findUnique({ where: { bookId } });
  // 当前读得比缓存更靠前 → 返回缓存会泄露未读词条，视为未命中。
  if (!cache || upto < cache.upto) return NextResponse.json({ cached: false });
  let entries: EncItem[];
  try {
    entries = JSON.parse(cache.data) as EncItem[];
  } catch {
    return NextResponse.json({ cached: false });
  }
  return NextResponse.json({ cached: true, stale: upto > cache.upto, upto: cache.upto, entries });
}

export async function POST(req: Request) {
  let parsed: { bookId?: string; upto?: number; readContext?: string; provider?: ProviderId };
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const { bookId, upto, readContext, provider } = parsed;
  const useCache = !!bookId && Number.isInteger(upto) && (upto as number) >= 0;

  const ctx = useCache ? await readContextUpto(bookId!, upto!) : readContext ?? "";
  if (!ctx.trim()) {
    return NextResponse.json({ error: "缺少已读内容" }, { status: 400 });
  }

  const ai = providerFor("enc", provider);
  let entries: EncItem[];
  try {
    const raw = await ai.chat(buildEncPrompt(ctx), { temperature: 0 });
    entries = parseEnc(raw);
  } catch (e) {
    return NextResponse.json(
      { error: "百科生成失败：" + (e as Error).message },
      { status: 502 },
    );
  }

  // 只缓存有效结果（识别到词条时），便于空结果后续重试。
  if (useCache && entries.length) {
    const data = JSON.stringify(entries);
    await prisma.encCache.upsert({
      where: { bookId: bookId! },
      create: { bookId: bookId!, upto: upto!, data },
      update: { upto: upto!, data },
    });
  }

  return NextResponse.json({ cached: false, upto: useCache ? upto : undefined, entries });
}
