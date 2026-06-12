// 把 DB 书（章节 / 段落）转成阅读器内容：分页成双页跨页。
import type { BookContent, Para, Spread } from "./types";

interface DbParagraph { id: string; text: string; translation: string | null }
interface DbChapter { index: number; title: string; paragraphs: DbParagraph[] }
interface DbBook {
  id: string; title: string; author: string | null; language: string;
  format: string; chapters: DbChapter[];
}

const CHARS_PER_PAGE = 720; // 单页字符预算

interface Page { ps: string[]; head?: string; headNo?: number }
/** 每章首段的元信息：段落 id → { 标题, 章序(1起) }。用于强制分页与章首大标题。 */
type ChapterStarts = Map<string, { title: string; no: number }>;

/** 把段落按字符预算切成「页」；遇到章节首段强制另起一页，并给该页打上章首标记。 */
function paginate(paras: Para[], starts: ChapterStarts): Page[] {
  const pages: Page[] = [];
  let cur: string[] = [];
  let budget = 0;
  let head: { title: string; no: number } | undefined;

  const flush = () => {
    if (!cur.length) return;
    pages.push({ ps: cur, head: head?.title, headNo: head?.no });
    cur = [];
    budget = 0;
    head = undefined;
  };

  for (const p of paras) {
    const len = p.segs.reduce((n, s) => n + s.t.length, 0);
    const start = starts.get(p.id);
    if (cur.length && (start || budget + len > CHARS_PER_PAGE)) flush();
    if (start && !cur.length) head = start; // 该页以章首段开头
    cur.push(p.id);
    budget += len;
  }
  flush();
  return pages.length ? pages : [{ ps: [] }];
}

/** 把页两两配成跨页，把章首标记透传到对应页。 */
function toSpreads(pages: Page[]): Spread[] {
  const spreads: Spread[] = [];
  for (let i = 0; i < pages.length; i += 2) {
    const l = pages[i];
    const r: Page = pages[i + 1] ?? { ps: [] };
    spreads.push({
      l: { no: i + 1, head: !!l.head || i === 0, headTitle: l.head, headNo: l.headNo, ps: l.ps },
      r: { no: i + 2, head: !!r.head, headTitle: r.head, headNo: r.headNo, ps: r.ps },
    });
  }
  return spreads;
}

export function dbBookToContent(book: DbBook): BookContent {
  const paras: Record<string, Para> = {};
  const flat: Para[] = [];
  const starts: ChapterStarts = new Map();
  const firstChapter = book.chapters[0];

  for (const ch of book.chapters) {
    const first = ch.paragraphs[0];
    if (first) starts.set(first.id, { title: ch.title, no: ch.index + 1 });
    for (const p of ch.paragraphs) {
      const para: Para = { id: p.id, segs: [{ t: p.text, plain: true }], zh: p.translation ?? undefined };
      paras[p.id] = para;
      flat.push(para);
    }
  }

  const spreads = toSpreads(paginate(flat, starts));

  // 段落 id → 首次出现的跨页索引，用来定位每章的跳转目标。
  const spreadOf: Record<string, number> = {};
  spreads.forEach((s, i) => {
    for (const id of [...s.l.ps, ...s.r.ps]) if (!(id in spreadOf)) spreadOf[id] = i;
  });

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
    spreads,
    toc: book.chapters.map((c) => {
      const first = c.paragraphs[0];
      return { label: c.title, meta: "", spread: first ? spreadOf[first.id] ?? 0 : undefined };
    }),
    chars: {},
    nodes: [],
    edges: [],
    enc: [],
    qa: [],
    recap: "",
  };
}
