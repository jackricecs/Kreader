# Kreader 読 · 轻小说阅读器

沉浸式日系轻小说阅读器。**EPUB / TXT 导入**，**防剧透 AI** 阅读助手，**可插拔模型**（QWEN / DeepSeek，面向中国大陆读者）。

> 设计理念书：[`docs/design-philosophy.html`](docs/design-philosophy.html)（在浏览器打开）。
> 视觉与交互来自 Claude Design 原型《Kreader》——和纸质感、明朝体、朱红、三主题。

## 技术栈

- **Next.js 16**（App Router · TypeScript · src 目录）— 前后端可分离：UI 为 React 组件，重活收敛到 Route Handlers。
- **Tailwind CSS v4** + CSS 变量驱动的三套主题（和纸 / 夜空 / 抹茶）。
- **Prisma**（默认 SQLite，可一行切 Postgres）— 段落级数据模型支撑防剧透。
- **AI Provider 抽象层** — QWEN / DeepSeek / 任意 OpenAI 兼容端点，仅用原生 `fetch`，支持流式。

## 快速开始

```bash
npm install
cp .env.example .env      # 填入 QWEN / DeepSeek 的 API Key
npm run db:push           # 按 schema 建库（dev.db）
npm run dev               # http://localhost:3000
```

## 目录结构

```
src/
  app/
    page.tsx                    首页（项目骨架说明）
    api/
      books/import/route.ts     EPUB/TXT 导入入口（单本 / 批量）
      ai/translate/route.ts     段落翻译（流式 · 注入术语表）
  lib/
    ai/                         Provider 抽象：types / openai-compatible / prompts / index
    epub/parse.ts               EPUB 解析占位 + TXT 智能分章
    theme/tokens.ts             三套主题色值
prisma/schema.prisma            Book / Chapter / Paragraph / Glossary / ReadingProgress
docs/design-philosophy.html     设计理念书
```

## 设计原则

1. **沉浸高于功能堆叠** — 默认是一本摊开的书，不是控制台。
2. **防剧透是底线** — 所有 AI 输出只能引用「已读段落」，在服务端用 `ReadingProgress` 强制截断上下文。
3. **日文排版一等公民** — 原生 `<ruby>` 振假名、禁则、（规划中）竖排右→左。
4. **随进度生长** — 人物图谱 / 百科 / 情绪曲线随阅读进度解锁。

## AI 模型配置

各功能可在 `.env` 独立指派 provider（也将在设置界面可改）：

| 功能 | 默认 | 说明 |
| --- | --- | --- |
| 翻译 translate | `qwen` | 中日翻译强，注入术语表保证全书译名一致 |
| 问答 qa | `deepseek` | 防剧透 system prompt，性价比高 |
| 提要 recap | `deepseek` | 无剧透前情提要 |

新增厂商：在 `src/lib/ai/index.ts` 的 `providerConfigs()` 里加一条即可。

## 路线图

- [x] 项目骨架 · AI Provider 层 · 主题 token · 导入/翻译 API 骨架
- [ ] 书库页 · 阅读页（对照原型实现）
- [ ] EPUB 解析接库 · 持久化到 Prisma
- [ ] 防剧透问答 / 前情提要 / 人物图谱 / 情绪曲线
- [ ] 设置界面：模型配置 · 排版 · 主题
- [ ] 上限层：氛围模式 · AI 插画 · 视觉小说模式
