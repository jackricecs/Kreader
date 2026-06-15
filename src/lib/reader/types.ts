// 阅读器内容模型。段落由「片段」组成：纯文本 / 带振假名 / 可查词。
// 导入的书只有纯文本片段；示例书额外带振假名与查词标注。

export interface Seg {
  t: string; // 显示文本
  r?: string; // 振假名读音（ruby）
  w?: string; // 查词 key（指向 DICT）
  word?: boolean; // 可点击查词
  rp?: boolean; // 仅注音、不可查词
  plain?: boolean; // 纯文本
}

export interface Para {
  id: string;
  segs: Seg[];
  zh?: string; // 预置译文（示例书有；导入书走 AI 翻译）
}

export interface SpreadSide {
  no: number;
  head?: boolean; // 是否显示章首大标题
  headTitle?: string; // 章首标题（导入书每章不同；示例书留空走 meta.chapterTitle）
  headNo?: number; // 章序（1 起），用于「第 N 章」眉标
  ps: string[]; // 段落 id 列表
  illus?: boolean; // AI 插画概念位
}

export interface Spread {
  l: SpreadSide;
  r: SpreadSide;
}

export interface DictEntry {
  w: string; // 词（汉字/原形）
  k: string; // 假名
  r: string; // 罗马音
  m: string; // 释义
  n: string; // JLPT 等级
  c: number; // 本书出现次数
  note: string;
}

export interface CharNode {
  id: string;
  x: number;
  y: number;
  name: string;
  locked?: boolean;
}

export interface CharEdge {
  a: [number, number];
  b: [number, number];
  label: string;
}

export interface CharBio {
  jp: string;
  zh: string;
  first: string;
  glyph: string;
  text: string;
}

export interface EncEntry {
  name: string;
  src?: string;
  text?: string;
  locked?: boolean;
  unlock?: string;
}

export interface QAEntry {
  id: string;
  q: string;
  a: string;
  spoiler?: boolean;
}

export interface TocEntry {
  label: string;
  meta: string;
  spread?: number; // 该章起始所在的跨页索引；有值才可点击跳转（导入书）
}

export interface ShelfBook {
  id: string;
  title: string;
  author: string;
  lang: string;
  fmt: string;
  prog: number;
  grad: string;
  series?: string;
  progLabel?: string;
  cur?: boolean;
  imported?: boolean; // 来自 DB 导入
}

export interface BookMeta {
  id: string;
  title: string;
  author: string;
  year?: string;
  lang: string;
  fmt: string;
  chapterTitle: string;
  chapterNo: string;
}

// 一本可阅读书的完整内容（示例书）。
export interface BookContent {
  meta: BookMeta;
  dict: Record<string, DictEntry>;
  paras: Record<string, Para>;
  spreads: Spread[];
  toc: TocEntry[];
  chars: Record<string, CharBio>;
  nodes: CharNode[];
  edges: CharEdge[];
  enc: EncEntry[];
  qa: QAEntry[];
  recap: string;
}

// 章节轻量元信息：用于「秒开目录」——只含标题与段落数，不含正文。
export interface ChapterMeta {
  index: number; // 章序，0 起
  title: string;
  paraCount: number;
}

// 导入书的「外壳」：服务端瞬时返回，正文按章懒加载。
export interface BookShell {
  meta: BookMeta;
  toc: ChapterMeta[];
  totalParas: number;
}
