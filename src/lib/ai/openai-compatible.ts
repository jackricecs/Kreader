// OpenAI 兼容客户端 —— QWEN（DashScope compatible-mode）与 DeepSeek 都走这一套。
// 仅用原生 fetch，无第三方依赖。

import type {
  AIProvider,
  ChatMessage,
  ChatOptions,
  ProviderConfig,
} from "./types";

export class OpenAICompatibleProvider implements AIProvider {
  constructor(public readonly config: ProviderConfig) {
    if (!config.apiKey) {
      // 不抛错，便于在未配置 Key 时仍能渲染 UI；真正调用时再报。
      console.warn(`[ai] provider "${config.id}" 缺少 apiKey，调用时会失败。`);
    }
  }

  private endpoint() {
    return `${this.config.baseURL.replace(/\/$/, "")}/chat/completions`;
  }

  private headers() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey}`,
    };
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    const res = await fetch(this.endpoint(), {
      method: "POST",
      headers: this.headers(),
      signal: opts.signal,
      body: JSON.stringify({
        model: this.config.model,
        messages,
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens,
        stream: false,
      }),
    });
    if (!res.ok) {
      throw new Error(`[ai:${this.config.id}] ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "";
  }

  async *stream(
    messages: ChatMessage[],
    opts: ChatOptions = {},
  ): AsyncIterable<string> {
    const res = await fetch(this.endpoint(), {
      method: "POST",
      headers: this.headers(),
      signal: opts.signal,
      body: JSON.stringify({
        model: this.config.model,
        messages,
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens,
        stream: true,
      }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`[ai:${this.config.id}] ${res.status} ${await res.text()}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE：以 \n\n 分隔事件，每行 "data: {json}"
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const evt of events) {
        const line = evt.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") return;
        try {
          const delta = JSON.parse(payload).choices?.[0]?.delta?.content;
          if (delta) yield delta as string;
        } catch {
          // 忽略心跳 / 不完整分片
        }
      }
    }
  }
}
