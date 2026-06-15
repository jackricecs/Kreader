import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { BOOK_CONTENTS } from "@/lib/sample/data";
import { dbBookToShell } from "@/lib/reader/build";
import ReaderView from "@/components/reader/ReaderView";
import type { BookContent, BookShell } from "@/lib/reader/types";

export const dynamic = "force-dynamic";

export default async function ReaderPage({
  params,
  searchParams,
}: {
  params: Promise<{ bookId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { bookId } = await params;
  const { tab } = await searchParams;

  // 示例书：内置全量内容，照旧整本渲染。
  const sample: BookContent | null = BOOK_CONTENTS[bookId] ?? null;
  if (sample) return <ReaderView content={sample} initialTab={tab} />;

  // 导入书：只查「外壳」（书名 + 目录 + 每章段落数），正文按章懒加载 → 秒开目录。
  let shell: BookShell | null = null;
  try {
    const book = await prisma.book.findUnique({
      where: { id: bookId },
      select: {
        id: true, title: true, author: true, language: true, format: true,
        chapters: {
          orderBy: { index: "asc" },
          select: { index: true, title: true, _count: { select: { paragraphs: true } } },
        },
      },
    });
    if (book) shell = dbBookToShell(book);
  } catch {
    shell = null;
  }

  if (!shell) notFound();

  return <ReaderView shell={shell} initialTab={tab} />;
}
