// OpenAI 兼容客户端 —— QWEN（DashScope compatible-mode）与 DeepSeek 都走这一套。
// 仅用原生 fetch，无第三方依赖。

import type {
  AIProvider,
  ChatMessage,
  ChatOptions,
  ProviderConfig,
} from "./types";

/** 判断是否为可重试的建连瞬时错误（连接超时 / 连接重置 / DNS 抖动）。 */
function isTransientConnectError(e: unknown): boolean {
  const codes = new Set([
    "UND_ERR_CONNECT_TIMEOUT",
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "EAI_AGAIN",
    "ENETUNREACH",
  ]);
  const cause = (e as { cause?: { code?: string } })?.cause;
  return Boolean(cause?.code && codes.has(cause.code));
}

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

  /**
   * 建连阶段的瞬时失败（连接超时 / 连接重置）做有限重试。
   * 经 VPN/代理出网时首个 TCP/TLS 握手偶发超时，重试即可恢复，
   * 避免段落首次翻译直接报「翻译失败」。仅重试「尚未收到响应」的请求，故幂等安全。
   */
  private async fetchWithRetry(
    body: string,
    signal?: AbortSignal,
    retries = 2,
  ): Promise<Response> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fetch(this.endpoint(), {
          method: "POST",
          headers: this.headers(),
          signal,
          body,
        });
      } catch (e) {
        lastErr = e;
        if (signal?.aborted || !isTransientConnectError(e) || attempt === retries) {
          throw e;
        }
        // 退避：200ms、500ms
        await new Promise((r) => setTimeout(r, attempt === 0 ? 200 : 500));
      }
    }
    throw lastErr;
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    const res = await this.fetchWithRetry(
      JSON.stringify({
        model: this.config.model,
        messages,
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens,
        stream: false,
      }),
      opts.signal,
    );
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
    const res = await this.fetchWithRetry(
      JSON.stringify({
        model: this.config.model,
        messages,
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens,
        stream: true,
      }),
      opts.signal,
    );
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
