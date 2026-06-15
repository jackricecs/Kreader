// 按章懒加载：返回某一章的段落正文（id / 原文 / 缓存译文）。
// 配合「秒开目录」——外壳先到，正文随读随取。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ bookId: string; index: string }> },
) {
  const { bookId, index } = await params;
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0) {
    return NextResponse.json({ error: "章序非法" }, { status: 400 });
  }

  const chapter = await prisma.chapter.findFirst({
    where: { bookId, index: idx },
    select: {
      index: true,
      title: true,
      paragraphs: {
        orderBy: { globalIndex: "asc" },
        select: { id: true, text: true, translation: true },
      },
    },
  });
  if (!chapter) return NextResponse.json({ error: "章节不存在" }, { status: 404 });

  return NextResponse.json({
    index: chapter.index,
    title: chapter.title,
    paras: chapter.paragraphs,
  });
}
