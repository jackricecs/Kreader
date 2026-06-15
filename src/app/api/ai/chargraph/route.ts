// AI 人物关系网：依据「已读上下文」抽取登场人物与关系，返回 JSON。
// 非流式（结果是结构化数据，需整体解析）。防剧透由 upto（已读段落上界）保证。
//
// 缓存（每本一份，键 bookId，带生成时的 upto）：
//   GET  ?bookId&upto  → 仅当「当前 upto >= 缓存 upto」时命中（缓存是已读前缀的子集，安全）。
//                        不命中或读得更靠前则返回 {cached:false}，绝不调用模型、绝不泄露未读人物。
//   POST {bookId,upto} → 服务端按 upto 组装上下文、调用模型、写入/覆盖缓存。
//                        兼容旧用法 {readContext}（无 bookId，则不缓存）。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { providerFor } from "@/lib/ai";
import { buildCharGraphPrompt } from "@/lib/ai/prompts";
import type { ProviderId } from "@/lib/ai/types";

export const runtime = "nodejs";

interface GraphChar { id: string; name: string; glyph: string; desc: string; first: string }
interface GraphRel { a: string; b: string; label: string }
interface Graph { characters: GraphChar[]; relations: GraphRel[] }

/** 从可能带 ``` 包裹或夹杂文字的输出里，抠出第一个 JSON 对象。 */
function parseGraph(raw: string): Graph {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return { characters: [], relations: [] };
  try {
    const obj = JSON.parse(raw.slice(start, end + 1));
    const characters: GraphChar[] = Array.isArray(obj.characters)
      ? obj.characters
          .filter((c: unknown): c is Record<string, unknown> => !!c && typeof c === "object")
          .map((c: Record<string, unknown>) => ({
            id: String(c.id ?? "").trim(),
            name: String(c.name ?? "").trim(),
            glyph: String(c.glyph ?? c.name ?? "?").trim().slice(0, 2) || "?",
            desc: String(c.desc ?? "").trim(),
            first: String(c.first ?? "").trim(),
          }))
          .filter((c: GraphChar) => c.id && c.name)
      : [];
    const ids = new Set(characters.map((c) => c.id));
    const relations: GraphRel[] = Array.isArray(obj.relations)
      ? obj.relations
          .filter((r: unknown): r is Record<string, unknown> => !!r && typeof r === "object")
          .map((r: Record<string, unknown>) => ({
            a: String(r.a ?? "").trim(),
            b: String(r.b ?? "").trim(),
            label: String(r.label ?? "").trim(),
          }))
          .filter((r: GraphRel) => ids.has(r.a) && ids.has(r.b) && r.a !== r.b)
      : [];
    return { characters, relations };
  } catch {
    return { characters: [], relations: [] };
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
  const cache = await prisma.charGraphCache.findUnique({ where: { bookId } });
  // 当前读得比缓存更靠前 → 返回缓存会泄露未读人物，视为未命中。
  if (!cache || upto < cache.upto) return NextResponse.json({ cached: false });
  let data: Graph;
  try {
    data = JSON.parse(cache.data) as Graph;
  } catch {
    return NextResponse.json({ cached: false });
  }
  return NextResponse.json({ cached: true, stale: upto > cache.upto, upto: cache.upto, ...data });
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

  const ai = providerFor("chargraph", provider);
  let graph: Graph;
  try {
    const raw = await ai.chat(buildCharGraphPrompt(ctx), { temperature: 0 });
    graph = parseGraph(raw);
  } catch (e) {
    return NextResponse.json(
      { error: "人物关系网生成失败：" + (e as Error).message },
      { status: 502 },
    );
  }

  // 只缓存有效结果（识别到人物时），便于空结果后续重试。
  if (useCache && graph.characters.length) {
    const data = JSON.stringify(graph);
    await prisma.charGraphCache.upsert({
      where: { bookId: bookId! },
      create: { bookId: bookId!, upto: upto!, data },
      update: { upto: upto!, data },
    });
  }

  return NextResponse.json({ cached: false, upto: useCache ? upto : undefined, ...graph });
}
