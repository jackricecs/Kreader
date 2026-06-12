// 书籍导入入口 —— 单本或批量。EPUB 走 epub 解析，TXT 走智能分章。
// 解析产物随后写入 DB（Book / Chapter / Paragraph）。持久化待 Prisma 接好后补上。

import { NextResponse } from "next/server";
import { parseEpub, parseTxt, type ParsedBook } from "@/lib/epub/parse";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);

  if (files.length === 0) {
    return NextResponse.json({ error: "未收到文件" }, { status: 400 });
  }

  const parsed: ParsedBook[] = [];
  const errors: { name: string; message: string }[] = [];

  for (const file of files) {
    try {
      const book = file.name.toLowerCase().endsWith(".epub")
        ? await parseEpub(file)
        : parseTxt(file.name, await file.text());
      parsed.push(book);
    } catch (e) {
      errors.push({ name: file.name, message: (e as Error).message });
    }
  }

  // TODO(persist): 用 Prisma 把 parsed 写入 Book/Chapter/Paragraph，并建 ReadingProgress。
  const summary = parsed.map((b) => ({
    title: b.title,
    author: b.author,
    language: b.language,
    format: b.format,
    chapters: b.chapters.length,
    paragraphs: b.chapters.reduce((n, c) => n + c.paragraphs.length, 0),
  }));

  return NextResponse.json({ imported: summary, errors });
}
