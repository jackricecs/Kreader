// 把 DB 书（章节 / 段落）转成阅读器内容：分页成双页跨页。
import type { BookContent, Para, Spread } from "./types";

interface DbParagraph { id: string; text: string; translation: string | null }
interface DbChapter { index: number; title: string; paragraphs: DbParagraph[] }
interface DbBook {
  id: string; title: string; author: string | null; language: string;
  format: string; chapters: DbChapter[];
}

const CHARS_PER_PAGE = 720; // 单页字符预算

/** 把段落按字符预算切成「页」，每页含若干段落 id。 */
function paginate(paras: Para[]): { ps: string[] }[] {
  const pages: { ps: string[] }[] = [];
  let cur: string[] = [];
  let budget = 0;
  for (const p of paras) {
    const len = p.segs.reduce((n, s) => n + s.t.length, 0);
    if (cur.length && budget + len > CHARS_PER_PAGE) {
      pages.push({ ps: cur });
      cur = [];
      budget = 0;
    }
    cur.push(p.id);
    budget += len;
  }
  if (cur.length) pages.push({ ps: cur });
  return pages.length ? pages : [{ ps: [] }];
}

/** 把页两两配成跨页。 */
function toSpreads(pages: { ps: string[] }[]): Spread[] {
  const spreads: Spread[] = [];
  for (let i = 0; i < pages.length; i += 2) {
    const l = pages[i];
    const r = pages[i + 1] ?? { ps: [] };
    spreads.push({
      l: { no: i + 1, head: i === 0, ps: l.ps },
      r: { no: i + 2, ps: r.ps },
    });
  }
  return spreads;
}

export function dbBookToContent(book: DbBook): BookContent {
  const paras: Record<string, Para> = {};
  const flat: Para[] = [];
  const firstChapter = book.chapters[0];

  for (const ch of book.chapters) {
    for (const p of ch.paragraphs) {
      const para: Para = { id: p.id, segs: [{ t: p.text, plain: true }], zh: p.translation ?? undefined };
      paras[p.id] = para;
      flat.push(para);
    }
  }

  const langLabel = book.language === "ja" ? "日文" : book.language === "zh" ? "中文" : book.language;

  return {
    meta: {
      id: book.id, title: book.title, author: book.author ?? "未知",
      lang: langLabel, fmt: book.format.toUpperCase(),
      chapterTitle: firstChapter?.title ?? "正文",
      chapterNo: firstChapter?.title ?? "正文",
    },
    dict: {},
    paras,
    spreads: toSpreads(paginate(flat)),
    toc: book.chapters.map((c) => ({ label: c.title, meta: "" })),
    chars: {},
    nodes: [],
    edges: [],
    enc: [],
    qa: [],
    recap: "",
  };
}
