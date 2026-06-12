// 书目数据访问：合并「示例书架」与「DB 导入书」。
import { prisma } from "@/lib/db";
import { SHELF_BOOKS } from "@/lib/sample/data";
import type { ShelfBook } from "@/lib/reader/types";

const GRADS = [
  "linear-gradient(160deg,#27354F,#101723)",
  "linear-gradient(160deg,#3B3550,#1E1A30)",
  "linear-gradient(160deg,#34404A,#161D24)",
  "linear-gradient(160deg,#46324E,#1F1426)",
  "linear-gradient(160deg,#2E4034,#141F18)",
  "linear-gradient(160deg,#4A2730,#221016)",
];

function gradFor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return GRADS[h % GRADS.length];
}

/** 列出全部书：示例书架在前，DB 导入书在后。DB 不可用时静默降级为仅示例。 */
export async function listBooks(): Promise<ShelfBook[]> {
  let imported: ShelfBook[] = [];
  try {
    const rows = await prisma.book.findMany({
      orderBy: { updatedAt: "desc" },
      include: { progress: true },
    });
    imported = rows.map((b) => ({
      id: b.id,
      title: b.title,
      author: b.author ?? "未知",
      lang: b.language === "ja" ? "日文" : b.language === "zh" ? "中文" : b.language,
      fmt: b.format.toUpperCase(),
      prog: Math.round(b.progress?.percent ?? 0),
      grad: gradFor(b.id),
      series: b.series ?? undefined,
      imported: true,
    }));
  } catch {
    imported = [];
  }
  return [...SHELF_BOOKS, ...imported];
}
