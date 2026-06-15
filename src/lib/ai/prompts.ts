// 把「防剧透」「术语表一致」这些设计原则固化成 prompt 构造器。
// 关键约束：传给模型的上下文永远只截取「已读段落」，在服务端强制。

import type { ChatMessage } from "./types";

export interface GlossaryEntry {
  source: string;
  target: string;
}

/** 翻译：注入术语表，保证全书译名一致。 */
export function buildTranslatePrompt(
  text: string,
  glossary: GlossaryEntry[],
  style: "literal" | "fluent" | "webnovel" = "fluent",
): ChatMessage[] {
  const styleHint = {
    literal: "尽量直译，保留原文句式与语气词。",
    fluent: "通顺自然的中文，意译为主，保留人物口癖。",
    webnovel: "中文网文腔，节奏明快。",
  }[style];

  const glossaryBlock = glossary.length
    ? "术语表（必须严格沿用以下译名，不得改动）：\n" +
      glossary.map((g) => `- ${g.source} → ${g.target}`).join("\n")
    : "（暂无术语表）";

  return [
    {
      role: "system",
      content:
        "你是轻小说翻译助手。把日文译成简体中文。" +
        styleHint +
        "\n" +
        glossaryBlock +
        "\n只输出译文本身，不要解释。",
    },
    { role: "user", content: text },
  ];
}

/**
 * 剧透安全问答：readContext 只包含「已读段落」。
 * 服务端务必在调用前用 readingProgress 截断段落，绝不传入未读内容。
 */
export function buildQaPrompt(question: string, readContext: string): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "你是读者的阅读伙伴。只能依据下面【已读正文】回答，" +
        "若问题涉及尚未读到的情节，必须礼貌拒绝并提示「为避免剧透，读到对应章节后再问」，" +
        "绝不可推测或泄露未读内容。\n\n【已读正文】\n" +
        readContext,
    },
    { role: "user", content: question },
  ];
}

/**
 * TXT 智能分章：给模型一段「段落序号 + 段首预览」清单，
 * 让它判断哪些段落是新章节的开头，并起标题。只回 JSON，便于服务端解析。
 */
export function buildSegmentPrompt(
  items: { index: number; preview: string }[],
): ChatMessage[] {
  const list = items.map((it) => `[${it.index}] ${it.preview}`).join("\n");
  return [
    {
      role: "system",
      content:
        "你是小说排版助手。下面是一篇没有分章的小说的连续段落，每行格式为「[全局序号] 段落开头预览」。" +
        "请判断哪些段落是【新章节的开头】——通常是章节标题行（如「第N章」「序章」「○○之章」）、" +
        "明显的时间/场景大转换，或独立成行的短标题。判定要克制，宁少勿多，普通段落不要当章节。" +
        "\n只输出一个 JSON 数组，每个元素形如 {\"index\": 序号, \"title\": \"简短章节标题\"}，" +
        "index 必须是上面出现过的序号，按升序。若这一段里没有任何新章节开头，输出空数组 []。" +
        "不要输出 JSON 以外的任何文字、解释或代码块标记。",
    },
    { role: "user", content: list },
  ];
}

/**
 * 人物关系网：只依据【已读正文】抽取登场人物与两两关系，只回 JSON，便于服务端解析。
 * 与问答 / 提要同源——绝不引入未读人物或未读关系，避免剧透。
 */
export function buildCharGraphPrompt(readContext: string): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "你是小说人物关系分析助手。只能依据下面【已读正文】，抽取已经登场的主要人物" +
        "（至多 8 人）以及他们之间**已在正文中体现**的关系。绝不可引入尚未读到的人物或关系，" +
        "不得臆测。\n" +
        "只输出一个 JSON 对象，格式严格如下：\n" +
        '{"characters":[{"id":"c1","name":"人物名（用原文或正文中的称呼）","glyph":"单字或双字代称","desc":"一句话简介","first":"首次出现的简短线索"}],' +
        '"relations":[{"a":"c1","b":"c2","label":"关系（如：同学/兄妹/师徒，2-4字）"}]}\n' +
        "id 用 c1、c2… 短标识，relations 里的 a/b 必须是上面出现过的 id。" +
        "若已读内容人物太少，characters 可少于 8，relations 可为空数组。" +
        "不要输出 JSON 以外的任何文字、解释或代码块标记。\n\n【已读正文】\n" +
        readContext,
    },
    { role: "user", content: "请输出已读范围内的人物关系网 JSON。" },
  ];
}

/** 前情提要：同样只基于已读内容，分「最近一章 + 全局主线」。 */
export function buildRecapPrompt(readContext: string): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "依据下面【已读正文】生成无剧透的『前情提要』，" +
        "用读者熟悉的口吻复述已发生的情节，不得引入未读内容。\n\n【已读正文】\n" +
        readContext,
    },
    { role: "user", content: "请生成『上回说到…』式的前情提要。" },
  ];
}
