// Provider 注册与按功能取用。凭据只在服务端从环境变量读取。

import { OpenAICompatibleProvider } from "./openai-compatible";
import type {
  AICapability,
  AIProvider,
  ProviderConfig,
  ProviderId,
} from "./types";

function env(key: string, fallback = ""): string {
  return process.env[key] ?? fallback;
}

/** 已配置的 provider 预设。新增厂商：在这里加一条即可。 */
export function providerConfigs(): Record<ProviderId, ProviderConfig> {
  return {
    qwen: {
      id: "qwen",
      label: "通义千问 QWEN",
      baseURL: env("QWEN_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1"),
      apiKey: env("QWEN_API_KEY"),
      model: env("QWEN_MODEL", "qwen-plus"),
    },
    deepseek: {
      id: "deepseek",
      label: "DeepSeek",
      baseURL: env("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
      apiKey: env("DEEPSEEK_API_KEY"),
      model: env("DEEPSEEK_MODEL", "deepseek-chat"),
    },
    custom: {
      id: "custom",
      label: "自定义端点",
      baseURL: env("CUSTOM_BASE_URL"),
      apiKey: env("CUSTOM_API_KEY"),
      model: env("CUSTOM_MODEL"),
    },
  };
}

/** 每个功能默认用哪个 provider（可被设置覆盖）。 */
function defaultForCapability(cap: AICapability): ProviderId {
  const map: Record<AICapability, string> = {
    translate: env("AI_PROVIDER_TRANSLATE", "qwen"),
    qa: env("AI_PROVIDER_QA", "deepseek"),
    recap: env("AI_PROVIDER_RECAP", "deepseek"),
    segment: env("AI_PROVIDER_SEGMENT", "deepseek"),
  };
  return (map[cap] as ProviderId) ?? "qwen";
}

export function getProvider(id: ProviderId): AIProvider {
  return new OpenAICompatibleProvider(providerConfigs()[id]);
}

/** 给定功能，返回当前指派的 provider。 */
export function providerFor(cap: AICapability, override?: ProviderId): AIProvider {
  return getProvider(override ?? defaultForCapability(cap));
}

export * from "./types";
