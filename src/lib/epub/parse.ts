// EPUB / TXT 解析管线。EPUB 用 jszip + fast-xml-parser（无原生依赖）。

import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

export interface ParsedParagraph {
  text: string;
}
export interface ParsedChapter {
  index: number;
  title: string;
  paragraphs: ParsedParagraph[];
}
export interface ParsedBook {
  title: string;
  author?: string;
  language: string;
  format: "epub" | "txt";
  coverPath?: string;
  chapters: ParsedChapter[];
}

/** 粗略语言探测：含假名→ja，含汉字→zh，否则 en。 */
export function detectLanguage(sample: string): string {
  if (/[぀-ヿ]/.test(sample)) return "ja";
  if (/[一-鿿]/.test(sample)) return "zh";
  return "en";
}

// 「第〇章」「序章」「プロローグ」「Chapter N」等
const CHAPTER_RE =
  /^(\s*)(第[一二三四五六七八九十百千〇0-9]+[章話巻部回節]|序章|終章|プロローグ|エピローグ|あとがき|Chapter\s+\d+).*/i;

/** TXT 智能分章。 */
export function parseTxt(filename: string, content: string): ParsedBook {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const chapters: ParsedChapter[] = [];
  let current: ParsedChapter | null = null;

  const pushPara = (text: string) => {
    const t = text.trim();
    if (!t) return;
    if (!current) {
      current = { index: 0, title: "正文", paragraphs: [] };
      chapters.push(current);
    }
    current.paragraphs.push({ text: t });
  };

  for (const line of lines) {
    if (CHAPTER_RE.test(line)) {
      current = { index: chapters.length, title: line.trim(), paragraphs: [] };
      chapters.push(current);
    } else {
      pushPara(line);
    }
  }

  return {
    title: filename.replace(/\.txt$/i, ""),
    language: detectLanguage(content.slice(0, 2000)),
    format: "txt",
    chapters: chapters.length ? chapters : [{ index: 0, title: "正文", paragraphs: [] }],
  };
}

// ── EPUB ──────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&[a-z]+;/gi, (m) => ENTITIES[m] ?? m);
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

function htmlToParagraphs(html: string): string[] {
  const body = html
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<rt>[\s\S]*?<\/rt>/gi, ""); // 丢弃振假名读音，仅留基字

  const ps = [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => stripTags(m[1]))
    .filter(Boolean);
  if (ps.length) return ps;

  // 无 <p>：按 <br> / 块级换行兜底
  const text = stripTags(body.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(div|h[1-6]|li)>/gi, "\n"));
  return text.split(/\n+/).map((t) => t.trim()).filter(Boolean);
}

function chapterTitle(html: string, fallback: string): string {
  const h = html.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
  if (h) { const t = stripTags(h[1]); if (t) return t; }
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) { const t = stripTags(title[1]); if (t) return t; }
  return fallback;
}

function resolvePath(base: string, rel: string): string {
  const baseDir = base.includes("/") ? base.replace(/\/[^/]*$/, "") : "";
  const parts = (baseDir ? baseDir.split("/") : []).concat(rel.split("/"));
  const out: string[] = [];
  for (const p of parts) {
    if (p === "." || p === "") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

export async function parseEpub(file: File): Promise<ParsedBook> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: true });

  // 1. container.xml → OPF 路径
  const containerXml = await zip.file("META-INF/container.xml")?.async("string");
  if (!containerXml) throw new Error("非法 EPUB：缺少 META-INF/container.xml");
  const container = parser.parse(containerXml);
  const opfPath: string = asArray(container?.container?.rootfiles?.rootfile)[0]?.["@_full-path"];
  if (!opfPath) throw new Error("非法 EPUB：找不到 OPF 路径");

  // 2. 解析 OPF：metadata / manifest / spine
  const opfXml = await zip.file(opfPath)?.async("string");
  if (!opfXml) throw new Error("非法 EPUB：读不到 OPF");
  const opf = parser.parse(opfXml).package;

  const meta = opf.metadata ?? {};
  const titleRaw = meta.title;
  const title = (typeof titleRaw === "object" ? titleRaw?.["#text"] : titleRaw) ?? file.name.replace(/\.epub$/i, "");
  const creatorRaw = asArray(meta.creator)[0];
  const author = typeof creatorRaw === "object" ? creatorRaw?.["#text"] : creatorRaw;
  const langRaw = asArray(meta.language)[0];
  const language = (typeof langRaw === "object" ? langRaw?.["#text"] : langRaw) ?? "ja";

  // manifest: id → href
  const manifest = new Map<string, string>();
  for (const item of asArray(opf.manifest?.item)) {
    manifest.set(item["@_id"], item["@_href"]);
  }

  // spine: 阅读顺序
  const itemrefs = asArray(opf.spine?.itemref).map((r) => r["@_idref"]);

  const chapters: ParsedChapter[] = [];
  for (const idref of itemrefs) {
    const href = manifest.get(idref);
    if (!href) continue;
    const fullPath = resolvePath(opfPath, href);
    const html = await zip.file(fullPath)?.async("string");
    if (!html) continue;
    const paras = htmlToParagraphs(html);
    if (!paras.length) continue; // 跳过封面/版权等空白页
    chapters.push({
      index: chapters.length,
      title: chapterTitle(html, `第 ${chapters.length + 1} 节`),
      paragraphs: paras.map((text) => ({ text })),
    });
  }

  if (!chapters.length) throw new Error("EPUB 解析后无可读正文");

  return {
    title: String(title).trim(),
    author: author ? String(author).trim() : undefined,
    language: String(language).slice(0, 2).toLowerCase(),
    format: "epub",
    chapters,
  };
}
