import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { BOOK_CONTENTS } from "@/lib/sample/data";
import { dbBookToContent } from "@/lib/reader/build";
import ReaderView from "@/components/reader/ReaderView";
import type { BookContent } from "@/lib/reader/types";

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

  let content: BookContent | null = BOOK_CONTENTS[bookId] ?? null;

  if (!content) {
    try {
      const book = await prisma.book.findUnique({
        where: { id: bookId },
        include: {
          chapters: { orderBy: { index: "asc" }, include: { paragraphs: { orderBy: { globalIndex: "asc" } } } },
        },
      });
      if (book) content = dbBookToContent(book);
    } catch {
      content = null;
    }
  }

  if (!content) notFound();

  return <ReaderView content={content} initialTab={tab} />;
}
