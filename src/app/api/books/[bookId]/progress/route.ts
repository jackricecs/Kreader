// 阅读进度持久化：每本一份（ReadingProgress，键 bookId）。
//   GET  → 返回 { paragraphIdx, percent }（无记录则全 0）。
//   POST { paragraphIdx, percent } → upsert。paragraphIdx 取「历史最远」高水位，
//          既驱动书架进度，也作为防剧透 AI（人物关系网 / 提要 / 百科）的已读上界，
//          这样回看前文时已生成的 AI 内容不会因当前位置靠前而被判为剧透隐藏。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ bookId: string }> },
) {
  const { bookId } = await params;
  const p = await prisma.readingProgress.findUnique({ where: { bookId } });
  return NextResponse.json({ paragraphIdx: p?.paragraphIdx ?? 0, percent: p?.percent ?? 0 });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ bookId: string }> },
) {
  const { bookId } = await params;
  let body: { paragraphIdx?: number; percent?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const paragraphIdx = Math.max(0, Math.floor(Number(body.paragraphIdx ?? 0)));
  const percent = Math.min(100, Math.max(0, Number(body.percent ?? 0)));
  if (!Number.isFinite(paragraphIdx) || !Number.isFinite(percent)) {
    return NextResponse.json({ error: "进度参数非法" }, { status: 400 });
  }

  // 书不存在则忽略（示例书等无 DB 记录的情况）。
  const exists = await prisma.book.findUnique({ where: { id: bookId }, select: { id: true } });
  if (!exists) return NextResponse.json({ ok: false, skipped: true });

  const prev = await prisma.readingProgress.findUnique({ where: { bookId } });
  // 高水位：只增不减，回看前文不会拉低已读上界。
  const nextIdx = Math.max(prev?.paragraphIdx ?? 0, paragraphIdx);
  const nextPct = Math.max(prev?.percent ?? 0, percent);

  const saved = await prisma.readingProgress.upsert({
    where: { bookId },
    create: { bookId, paragraphIdx: nextIdx, percent: nextPct },
    update: { paragraphIdx: nextIdx, percent: nextPct },
  });
  return NextResponse.json({ ok: true, paragraphIdx: saved.paragraphIdx, percent: saved.percent });
}
