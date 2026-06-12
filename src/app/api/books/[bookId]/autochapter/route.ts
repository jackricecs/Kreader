// TXT/无章节书的 AI 智能分章：让模型在段落流里找章节边界，再在事务里重建章节。
// 仅重组「段落 → 章节」的归属，不改动段落本身（globalIndex / 译文缓存都保留）。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { providerFor } from "@/lib/ai";
import { buildSegmentPrompt } from "@/lib/ai/prompts";
import type { ProviderId } from "@/lib/ai/types";

export const runtime = "nodejs";

const WINDOW = 120; // 每次喂给模型的段落数
const PREVIEW = 48; // 每段预览字符数
const OFFSET = 100000; // 重建期间新章节的临时章序，避开与旧章序冲突

interface Boundary { index: number; title: string }

/** 把模型可能带 ``` 包裹或夹杂文字的输出里，抠出第一个 JSON 数组。 */
function parseBoundaries(raw: string): Boundary[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  try {
    const arr = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x.index === "number")
      .map((x) => ({ index: x.index, title: String(x.title ?? "").trim() }));
  } catch {
    return [];
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ bookId: string }> },
) {
  const { bookId } = await params;
  const provider = (new URL(req.url).searchParams.get("provider") as ProviderId) || undefined;

  const book = await prisma.book.findUnique({
    where: { id: bookId },
    include: {
      chapters: {
        orderBy: { index: "asc" },
        include: { paragraphs: { orderBy: { globalIndex: "asc" } } },
      },
    },
  });
  if (!book) return NextResponse.json({ error: "书不存在" }, { status: 404 });

  const paras = book.chapters
    .flatMap((c) => c.paragraphs)
    .sort((a, b) => a.globalIndex - b.globalIndex);
  if (paras.length < 4) {
    return NextResponse.json({ error: "段落太少，无需分章" }, { status: 400 });
  }

  // 1. 逐窗口让模型找章节边界
  const ai = providerFor("segment", provider);
  const found: Boundary[] = [];
  try {
    for (let off = 0; off < paras.length; off += WINDOW) {
      const slice = paras.slice(off, off + WINDOW);
      const items = slice.map((p) => ({
        index: p.globalIndex,
        preview: p.text.slice(0, PREVIEW).replace(/\s+/g, " "),
      }));
      const raw = await ai.chat(buildSegmentPrompt(items), { temperature: 0 });
      found.push(...parseBoundaries(raw));
    }
  } catch (e) {
    return NextResponse.json(
      { error: "AI 分章调用失败：" + (e as Error).message },
      { status: 502 },
    );
  }

  // 2. 归一化边界：去掉越界/重复，保证以全书首段为第一章
  const valid = new Set(paras.map((p) => p.globalIndex));
  const titleByIndex = new Map<number, string>();
  for (const b of found) if (valid.has(b.index)) titleByIndex.set(b.index, b.title);

  const first = paras[0].globalIndex;
  const cuts = [...new Set([first, ...titleByIndex.keys()])].sort((a, b) => a - b);
  const segments = cuts.map((startIdx, k) => ({
    start: startIdx,
    end: cuts[k + 1] ?? Infinity,
    title: titleByIndex.get(startIdx)?.trim() || `第 ${k + 1} 章`,
  }));

  // 3. 事务内重建章节：先建新章（临时高章序），迁移段落，删空旧章，再回填正式章序
  await prisma.$transaction(async (tx) => {
    const fresh: string[] = [];
    for (let k = 0; k < segments.length; k++) {
      const ch = await tx.chapter.create({
        data: { bookId, index: OFFSET + k, title: segments[k].title.slice(0, 120) },
      });
      fresh.push(ch.id);
    }
    for (let k = 0; k < segments.length; k++) {
      const { start, end } = segments[k];
      await tx.paragraph.updateMany({
        where: {
          chapter: { bookId },
          globalIndex: end === Infinity ? { gte: start } : { gte: start, lt: end },
        },
        data: { chapterId: fresh[k] },
      });
    }
    await tx.chapter.deleteMany({ where: { bookId, index: { lt: OFFSET } } });
    for (let k = 0; k < fresh.length; k++) {
      await tx.chapter.update({ where: { id: fresh[k] }, data: { index: k } });
    }
  }, { timeout: 30000 });

  return NextResponse.json({ chapters: segments.length });
}
