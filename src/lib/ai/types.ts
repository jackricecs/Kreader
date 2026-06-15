// AI Provider 抽象层 —— 一套接口，QWEN / DeepSeek / 任意 OpenAI 兼容端点同形接入。

export type ProviderId = "qwen" | "deepseek" | "custom";

/** 一个具体的模型接入点。凭据从环境变量读取，前端只见到 id/label/model。 */
export interface ProviderConfig {
  id: ProviderId;
  label: string;
  baseURL: string;
  apiKey: string;
  model: string;
}

export type Role = "system" | "user" | "assistant";

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  /** true 时返回流式 token；否则一次性返回整段文本。 */
  stream?: boolean;
  signal?: AbortSignal;
}

/** 所有阅读 AI 能力（翻译 / 问答 / 提要）都通过它调用。 */
export interface AIProvider {
  readonly config: ProviderConfig;
  /** 非流式：返回完整回答。 */
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<string>;
  /** 流式：逐 token 产出，便于打字机式 UI。 */
  stream(messages: ChatMessage[], opts?: ChatOptions): AsyncIterable<string>;
}

/** Kreader 里需要指派模型的功能点。每个都可在设置里独立选 provider。 */
export type AICapability = "translate" | "qa" | "recap" | "segment" | "chargraph";
