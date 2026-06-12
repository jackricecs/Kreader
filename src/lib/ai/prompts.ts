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
