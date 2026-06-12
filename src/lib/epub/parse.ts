// EPUB / TXT 解析管线。
// EPUB 解析将接入 epub 库（实现时再装依赖）；此处先给出统一的结构产物与 TXT 智能分章实现。

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

/** 粗略语言探测：含假名→ja，含中日统一表意文字→zh，否则 en。 */
export function detectLanguage(sample: string): string {
  if (/[぀-ヿ]/.test(sample)) return "ja"; // 平假名 / 片假名
  if (/[一-鿿]/.test(sample)) return "zh";
  return "en";
}

// 「第〇章」「序章」「プロローグ」「Chapter N」等常见分章标记
const CHAPTER_RE =
  /^(\s*)(第[一二三四五六七八九十百千〇0-9]+[章話卷部回節]|序章|終章|プロローグ|エピローグ|あとがき|Chapter\s+\d+).*/i;

/** TXT 智能分章：识别章节标题行；识别不到则整本归为一章。 */
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

/** EPUB 解析：占位。实现时接入 epub 库，解出目录树 / 封面 / 章节正文。 */
export async function parseEpub(_file: File): Promise<ParsedBook> {
  // TODO: 接入 epub 解析库，提取 spine / nav / metadata / cover。
  throw new Error("EPUB 解析尚未实现：将在导入管线里接入 epub 库。");
}
