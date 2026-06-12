// 书籍导入入口 —— 单本或批量。EPUB 走 epub 解析，TXT 走智能分章，随后持久化到 DB。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseEpub, parseTxt, type ParsedBook } from "@/lib/epub/parse";

export const runtime = "nodejs";

async function persist(book: ParsedBook): Promise<{ id: string; title: string }> {
  let g = 0; // 全书段落序号
  const created = await prisma.book.create({
    data: {
      title: book.title,
      author: book.author,
      language: book.language,
      format: book.format,
      coverPath: book.coverPath,
      chapters: {
        create: book.chapters.map((c) => ({
          index: c.index,
          title: c.title,
          paragraphs: { create: c.paragraphs.map((p) => ({ globalIndex: g++, text: p.text })) },
        })),
      },
      progress: { create: { paragraphIdx: 0, percent: 0 } },
    },
  });
  return { id: created.id, title: created.title };
}

export async function POST(req: Request) {
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);

  if (files.length === 0) {
    return NextResponse.json({ error: "未收到文件" }, { status: 400 });
  }

  const imported: { id: string; title: string; chapters: number; paragraphs: number }[] = [];
  const errors: { name: string; message: string }[] = [];

  for (const file of files) {
    try {
      const book = file.name.toLowerCase().endsWith(".epub")
        ? await parseEpub(file)
        : parseTxt(file.name, await file.text());
      const { id, title } = await persist(book);
      imported.push({
        id,
        title,
        chapters: book.chapters.length,
        paragraphs: book.chapters.reduce((n, c) => n + c.paragraphs.length, 0),
      });
    } catch (e) {
      errors.push({ name: file.name, message: (e as Error).message });
    }
  }

  return NextResponse.json({ imported, errors });
}
