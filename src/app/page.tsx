const NEXT_STEPS = [
  { k: "书库页", d: "封面墙 · 系列归组 · 继续阅读 · 搜索筛选" },
  { k: "阅读页", d: "和纸双页书卷 · 振假名 · 点词查词 · 段落对照" },
  { k: "导入管线", d: "EPUB / TXT 解析 · 智能分章 · 写入数据模型" },
  { k: "AI 助手", d: "防剧透问答 · 前情提要 · 人物图谱 · 情绪曲线" },
  { k: "模型设置", d: "QWEN / DeepSeek 可插拔 · 各功能独立指派" },
];

export default function Home() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center px-8 py-20">
      <div className="w-full max-w-2xl">
        <div className="flex items-center gap-3 select-none">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ background: "var(--acc)", boxShadow: "0 2px 8px rgba(178,58,42,0.4)" }}
          >
            <span
              className="text-[20px] font-bold"
              style={{ color: "#FBF6EA", fontFamily: "var(--font-mincho)" }}
            >
              読
            </span>
          </div>
          <div>
            <div className="text-base font-bold tracking-wider">Kreader</div>
            <div className="text-[10px] tracking-[3px]" style={{ color: "var(--ink2)" }}>
              轻小说阅读器
            </div>
          </div>
        </div>

        <h1
          className="mt-10 text-5xl font-semibold tracking-wider leading-tight"
          style={{ fontFamily: "var(--font-mincho)" }}
        >
          把读轻小说
          <br />
          做成一件爽的事
        </h1>
        <div className="w-12 h-[3px] my-6" style={{ background: "var(--acc)" }} />
        <p className="text-[15px] leading-9" style={{ color: "var(--ink2)" }}>
          沉浸式日系阅读体验 · 防剧透 AI 阅读助手 · EPUB/TXT 导入 ·
          可插拔模型（QWEN / DeepSeek）。项目骨架已就绪，下面是接下来要落地的部分。
        </p>

        <div className="mt-10 grid gap-3">
          {NEXT_STEPS.map((s, i) => (
            <div
              key={s.k}
              className="rounded-xl border px-5 py-4 flex items-baseline gap-4"
              style={{ background: "var(--page)", borderColor: "var(--line)" }}
            >
              <span className="text-xs font-mono" style={{ color: "var(--acc)" }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <div
                  className="text-[15px] font-semibold"
                  style={{ fontFamily: "var(--font-mincho)" }}
                >
                  {s.k}
                </div>
                <div className="text-[13px]" style={{ color: "var(--ink2)" }}>
                  {s.d}
                </div>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-8 text-[12px]" style={{ color: "var(--ink2)" }}>
          设计理念见 <code>docs/design-philosophy.html</code>。
        </p>
      </div>
    </main>
  );
}
