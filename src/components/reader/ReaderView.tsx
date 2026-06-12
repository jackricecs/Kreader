"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { THEMES, type ThemeId } from "@/lib/theme/tokens";
import type { BookContent, Para, Seg, SpreadSide } from "@/lib/reader/types";

// 1–99 的中文数字，用于「第 N 章」眉标。
const CN = "零一二三四五六七八九十";
function cnNum(n: number): string {
  if (n <= 10) return CN[n] ?? String(n);
  if (n < 20) return "十" + CN[n - 10];
  if (n < 100) return CN[Math.floor(n / 10)] + "十" + (n % 10 ? CN[n % 10] : "");
  return String(n);
}

const LH_OPTS = [
  { v: 1.8, label: "紧" },
  { v: 2.1, label: "适中" },
  { v: 2.4, label: "疏" },
];
const TABS = [
  { id: "chars", label: "人物" },
  { id: "enc", label: "百科" },
  { id: "emo", label: "情绪" },
  { id: "qa", label: "问答" },
  { id: "recap", label: "回顾" },
];

interface WC { key: string; x: number; y: number }
interface TState { loading: boolean; text: string }

export default function ReaderView({
  content,
  initialTab,
}: {
  content: BookContent;
  initialTab?: string;
}) {
  const { meta, paras, dict, spreads, toc, chars, nodes, edges, enc, qa, recap } = content;
  const router = useRouter();

  const [spread, setSpread] = useState(0);
  const [chaptering, setChaptering] = useState(false);
  const [animA, setAnimA] = useState(true);
  const [tab, setTab] = useState(initialTab && TABS.some((t) => t.id === initialTab) ? initialTab : "chars");
  const [biMode, setBiMode] = useState(false);
  const [ambience, setAmbience] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fs, setFs] = useState(17);
  const [lh, setLh] = useState(2.1);
  const [theme, setTheme] = useState<ThemeId>("paper");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [trans, setTrans] = useState<Record<string, TState>>({});
  const [wc, setWc] = useState<WC | null>(null);
  const [selChar, setSelChar] = useState(nodes[0]?.id ?? "");
  const [qaId, setQaId] = useState<string | null>(null);
  const [qaLive, setQaLive] = useState<TState | null>(null);
  const [recapLive, setRecapLive] = useState<TState | null>(null);
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [vocabCount, setVocabCount] = useState(8);

  const sp = spreads[spread];
  const lastNo = useMemo(() => Math.max(...spreads.flatMap((s) => [s.l.no, s.r.no])), [spreads]);
  const total = meta.id === "ginga" ? 248 : lastNo;

  const next = useCallback(() => {
    setSpread((s) => (s < spreads.length - 1 ? s + 1 : s));
    setAnimA((a) => !a);
    setWc(null);
  }, [spreads.length]);
  const prev = useCallback(() => {
    setSpread((s) => (s > 0 ? s - 1 : s));
    setAnimA((a) => !a);
    setWc(null);
  }, []);
  const goTo = useCallback((i: number) => {
    setSpread(Math.max(0, Math.min(spreads.length - 1, i)));
    setAnimA((a) => !a);
    setWc(null);
  }, [spreads.length]);

  // 当前所在章：spread 落在哪个章的起始之后。
  const curChapter = useMemo(() => {
    let idx = -1;
    toc.forEach((c, i) => { if (typeof c.spread === "number" && c.spread <= spread) idx = i; });
    return idx;
  }, [toc, spread]);

  // TXT 等单章导入书：AI 智能分章后刷新页面重新分章。
  const onAutoChapter = useCallback(async () => {
    setChaptering(true);
    try {
      const res = await fetch(`/api/books/${meta.id}/autochapter`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `${res.status}`);
      router.refresh();
    } catch (e) {
      alert("智能分章失败：" + (e as Error).message);
    } finally {
      setChaptering(false);
    }
  }, [meta.id, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "Escape") { setWc(null); setSettingsOpen(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev]);

  // ── AI 翻译（导入书无预置译文时）──
  const fetchTranslate = useCallback(async (id: string, text: string) => {
    setTrans((t) => ({ ...t, [id]: { loading: true, text: "" } }));
    try {
      const res = await fetch("/api/ai/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.body) throw new Error("no stream");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setTrans((t) => ({ ...t, [id]: { loading: true, text: acc } }));
      }
      setTrans((t) => ({ ...t, [id]: { loading: false, text: acc } }));
    } catch (e) {
      setTrans((t) => ({ ...t, [id]: { loading: false, text: "[翻译失败] " + (e as Error).message } }));
    }
  }, []);

  const onPara = (id: string) => {
    setWc(null);
    const para = paras[id];
    if (expanded[id]) { setExpanded((x) => ({ ...x, [id]: false })); return; }
    setExpanded((x) => ({ ...x, [id]: true }));
    if (!para.zh && !trans[id]) {
      fetchTranslate(id, para.segs.map((s) => s.t).join(""));
    }
  };

  // 双语对照：自动翻译当前跨页中无预置译文的段落
  useEffect(() => {
    if (!biMode || !sp) return;
    for (const id of [...sp.l.ps, ...sp.r.ps]) {
      const para = paras[id];
      if (para && !para.zh && !trans[id]) fetchTranslate(id, para.segs.map((s) => s.t).join(""));
    }
  }, [biMode, sp, paras, trans, fetchTranslate]);

  const onWord = (e: React.MouseEvent, key: string) => {
    e.stopPropagation();
    const x = Math.min(e.clientX - 30, window.innerWidth - 310);
    let y = e.clientY + 18;
    if (y > window.innerHeight - 300) y = e.clientY - 290;
    setWc({ key, x: Math.max(12, x), y: Math.max(12, y) });
  };

  // 已读上下文（用于剧透安全问答 / 提要）
  const readContext = useMemo(() => {
    const ids: string[] = [];
    for (let i = 0; i <= spread; i++) ids.push(...spreads[i].l.ps, ...spreads[i].r.ps);
    return ids.map((id) => paras[id]?.segs.map((s) => s.t).join("")).filter(Boolean).join("\n");
  }, [spread, spreads, paras]);

  async function streamInto(url: string, body: object, set: (s: TState) => void) {
    set({ loading: true, text: "" });
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.body) throw new Error("no stream");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        set({ loading: true, text: acc });
      }
      set({ loading: false, text: acc });
    } catch (e) {
      set({ loading: false, text: "[失败] " + (e as Error).message });
    }
  }

  const onQaCustom = (q: string) => { setQaId(null); streamInto("/api/ai/qa", { question: q, readContext }, setQaLive); };
  const onRecap = () => streamInto("/api/ai/recap", { readContext }, setRecapLive);

  const T = THEMES[theme];
  const rootVars = {
    "--app": T.app, "--page": T.page, "--ink": T.ink, "--ink2": T.ink2,
    "--line": T.line, "--acc": T.acc, "--soft": T.soft,
    "--fs": fs + "px", "--lh": String(lh),
  } as React.CSSProperties;

  const bookPct = Math.round((sp.r.no / total) * 100);

  // ── 片段渲染 ──
  const renderSegs = (para: Para) =>
    para.segs.map((s: Seg, i) => {
      if (s.word) {
        return (
          <span key={i} onClick={(e) => onWord(e, s.w!)} style={{ cursor: "pointer", borderBottom: "1px dashed var(--acc)", paddingBottom: 1 }}>
            <ruby>{s.t}<rt style={{ fontSize: "0.48em", color: "var(--ink2)", letterSpacing: 0 }}>{s.r}</rt></ruby>
          </span>
        );
      }
      if (s.rp) return <ruby key={i}>{s.t}<rt style={{ fontSize: "0.48em", color: "var(--ink2)", letterSpacing: 0 }}>{s.r}</rt></ruby>;
      return <span key={i}>{s.t}</span>;
    });

  const renderPara = (id: string) => {
    const para = paras[id];
    if (!para) return null;
    const show = !!(biMode || expanded[id]);
    const zhText = para.zh ?? trans[id]?.text ?? "";
    const loading = !para.zh && trans[id]?.loading;
    return (
      <div key={id} onClick={() => onPara(id)} title="点击切换译文" style={{ cursor: "pointer", margin: "0 0 1.5em 0", borderRadius: 6 }}>
        <p style={{ margin: 0, fontFamily: "var(--font-mincho)", fontSize: "var(--fs)", lineHeight: "var(--lh)", color: "var(--ink)", textAlign: "justify", letterSpacing: "0.015em" }}>
          {renderSegs(para)}
        </p>
        {show && (
          <div style={{ marginTop: 8, marginBottom: 6, padding: "10px 14px", background: "var(--soft)", borderLeft: "2px solid var(--acc)", borderRadius: "0 8px 8px 0" }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 2.5, color: "var(--acc)", marginBottom: 5 }}>
              译文 · AI{para.zh ? " · 术语表已应用" : loading ? " · 生成中…" : ""}
            </div>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.95, color: "var(--ink)", opacity: 0.85 }}>{zhText || (loading ? "…" : "")}</p>
          </div>
        )}
      </div>
    );
  };

  // 章首大标题：导入书每章用自己的标题与章序，示例书回退到 meta。
  const renderHead = (side: SpreadSide) => {
    if (!side.head) return null;
    const eyebrow = side.headNo ? `第 ${cnNum(side.headNo)} 章` : "第 一 章";
    const title = side.headTitle ?? meta.chapterTitle;
    return (
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 10, letterSpacing: 4, color: "var(--acc)", fontWeight: 700, marginBottom: 8 }}>{eyebrow}</div>
        <div style={{ fontFamily: "var(--font-mincho)", fontSize: 26, fontWeight: 600, color: "var(--ink)", letterSpacing: 2 }}>{title}</div>
        <div style={{ width: 42, height: 2, background: "var(--acc)", marginTop: 12 }} />
      </div>
    );
  };

  const word = wc ? dict[wc.key] : null;
  const hasAI = nodes.length > 0;

  return (
    <div style={{ ...rootVars, height: "100vh", display: "flex", flexDirection: "column", background: "var(--app)", fontFamily: "var(--font-serif)", overflow: "hidden" }}>
      {/* 顶栏 */}
      <div style={{ height: 56, flex: "none", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px", borderBottom: "1px solid var(--line)", position: "relative", zIndex: 30 }}>
        <Link href="/" title="返回书库" style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer", userSelect: "none", textDecoration: "none" }}>
          <div style={{ width: 32, height: 32, borderRadius: 7, background: "var(--acc)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 6px rgba(178,58,42,0.35)" }}>
            <span style={{ color: "#FBF6EA", fontFamily: "var(--font-mincho)", fontSize: 16, fontWeight: 700 }}>読</span>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)", letterSpacing: 1.5 }}>Kreader</div>
            <div style={{ fontSize: 10, color: "var(--ink2)", letterSpacing: 3 }}>轻小说阅读器</div>
          </div>
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontFamily: "var(--font-mincho)", fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>
            {meta.title}<span style={{ fontSize: 11, fontWeight: 400, color: "var(--ink2)", marginLeft: 8 }}>{meta.author}</span>
          </div>
          <div style={{ fontSize: 11, color: "var(--ink2)", background: "var(--soft)", border: "1px solid var(--line)", padding: "3px 10px", borderRadius: 999 }}>{meta.chapterNo}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => setBiMode((v) => !v)} title="所有段落显示中文对照" style={{ cursor: "pointer", fontFamily: "inherit", fontSize: 12, padding: "6px 12px", borderRadius: 8, border: `1px solid ${biMode ? "var(--acc)" : "var(--line)"}`, background: biMode ? "var(--acc)" : "var(--page)", color: biMode ? "#FBF6EA" : "var(--ink)", letterSpacing: 1 }}>双语对照</button>
          <button onClick={() => setAmbience((v) => !v)} title="根据章节情绪渲染氛围（概念演示）" style={{ cursor: "pointer", fontFamily: "inherit", fontSize: 12, padding: "6px 12px", borderRadius: 8, border: `1px solid ${ambience ? "#27354F" : "var(--line)"}`, background: ambience ? "#27354F" : "var(--page)", color: ambience ? "#D8DEF0" : "var(--ink)", letterSpacing: 1 }}>氛围</button>
          <button onClick={() => setSettingsOpen((v) => !v)} title="阅读外观" style={{ cursor: "pointer", fontFamily: "inherit", fontSize: 13, padding: "6px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--page)", color: "var(--ink)" }}>Aa</button>
        </div>
        {settingsOpen && (
          <div style={{ position: "absolute", top: 52, right: 16, width: 268, background: "var(--page)", border: "1px solid var(--line)", borderRadius: 14, boxShadow: "0 18px 44px -12px rgba(50,35,15,0.35)", padding: 16, zIndex: 50 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2.5, color: "var(--ink2)", marginBottom: 10 }}>阅读外观</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: "var(--ink)" }}>字号</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button onClick={() => setFs((v) => Math.max(14, v - 1))} style={{ cursor: "pointer", width: 28, height: 28, borderRadius: 7, border: "1px solid var(--line)", background: "transparent", color: "var(--ink)", fontFamily: "inherit", fontSize: 13 }}>A−</button>
                <span style={{ fontSize: 12, color: "var(--ink2)", width: 30, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{fs}px</span>
                <button onClick={() => setFs((v) => Math.min(22, v + 1))} style={{ cursor: "pointer", width: 28, height: 28, borderRadius: 7, border: "1px solid var(--line)", background: "transparent", color: "var(--ink)", fontFamily: "inherit", fontSize: 13 }}>A＋</button>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: "var(--ink)" }}>行距</span>
              <div style={{ display: "flex", gap: 6 }}>
                {LH_OPTS.map((o) => {
                  const on = Math.abs(o.v - lh) < 0.01;
                  return <button key={o.v} onClick={() => setLh(o.v)} style={{ cursor: "pointer", fontFamily: "inherit", fontSize: 11, padding: "5px 10px", borderRadius: 7, border: `1px solid ${on ? "var(--acc)" : "var(--line)"}`, background: on ? "var(--acc)" : "transparent", color: on ? "#FBF6EA" : "var(--ink)" }}>{o.label}</button>;
                })}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <span style={{ fontSize: 12, color: "var(--ink)" }}>主题</span>
              <div style={{ display: "flex", gap: 8 }}>
                {(Object.keys(THEMES) as ThemeId[]).map((id) => (
                  <button key={id} onClick={() => setTheme(id)} title={THEMES[id].name} style={{ cursor: "pointer", width: 30, height: 30, borderRadius: 999, border: `2px solid ${id === theme ? "var(--acc)" : "var(--line)"}`, background: THEMES[id].page, padding: 0 }} />
                ))}
              </div>
            </div>
            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2.5, color: "var(--ink2)", marginBottom: 8 }}>排版</div>
              <div style={{ display: "flex", gap: 6 }}>
                <span style={{ fontSize: 11, padding: "5px 10px", borderRadius: 7, background: "var(--acc)", color: "#FBF6EA" }}>横排 · 翻页</span>
                <span style={{ fontSize: 11, padding: "5px 10px", borderRadius: 7, border: "1px dashed var(--line)", color: "var(--ink2)" }}>竖排 右→左</span>
                <span style={{ fontSize: 11, padding: "5px 10px", borderRadius: 7, border: "1px dashed var(--line)", color: "var(--ink2)" }}>滚动</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 主体三栏 */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* 左栏 · 目次 */}
        <div style={{ width: 228, flex: "none", borderRight: "1px solid var(--line)", display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ padding: "16px 16px 12px 16px", display: "flex", gap: 12, borderBottom: "1px solid var(--line)" }}>
            <div style={{ width: 64, height: 92, flex: "none", borderRadius: 4, background: "linear-gradient(160deg,#27354F,#101723)", boxShadow: "0 6px 14px -4px rgba(30,30,50,0.5)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 10 }}>
              <span style={{ writingMode: "vertical-rl", fontFamily: "var(--font-mincho)", fontSize: 12, color: "#E8E2CF", letterSpacing: 3 }}>{meta.title}</span>
            </div>
            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 5, paddingTop: 4 }}>
              <div style={{ fontFamily: "var(--font-mincho)", fontSize: 13, fontWeight: 600, color: "var(--ink)", lineHeight: 1.4 }}>{meta.title}</div>
              <div style={{ fontSize: 11, color: "var(--ink2)" }}>{meta.author}{meta.year ? " · " + meta.year : ""}</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                <span style={{ fontSize: 9, letterSpacing: 1, padding: "2px 6px", borderRadius: 4, background: "var(--soft)", border: "1px solid var(--line)", color: "var(--ink2)" }}>{meta.fmt}</span>
                <span style={{ fontSize: 9, letterSpacing: 1, padding: "2px 6px", borderRadius: 4, background: "var(--soft)", border: "1px solid var(--line)", color: "var(--ink2)" }}>{meta.lang}</span>
              </div>
              <div style={{ fontSize: 10, color: "var(--ink2)", marginTop: 2 }}>已读 <span style={{ color: "var(--acc)", fontWeight: 600 }}>{bookPct}%</span></div>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "12px 10px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 8px 8px 8px" }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 3, color: "var(--ink2)" }}>目次</span>
              {meta.fmt === "TXT" && toc.length <= 1 && (
                <button onClick={onAutoChapter} disabled={chaptering} title="用 AI 把整篇无章节文本自动切分成章节" style={{ cursor: chaptering ? "default" : "pointer", fontFamily: "inherit", fontSize: 10, letterSpacing: 1, padding: "3px 8px", borderRadius: 6, border: "1px solid var(--acc)", background: "transparent", color: "var(--acc)", opacity: chaptering ? 0.6 : 1 }}>{chaptering ? "分章中…" : "AI 智能分章"}</button>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {toc.map((ch, i) => {
                const jumpable = typeof ch.spread === "number";
                // 导入书按当前阅读位置高亮；示例书（无 spread）维持仅首章高亮的原型外观。
                const active = jumpable ? i === curChapter : i === 0;
                return (
                  <div
                    key={i}
                    onClick={jumpable ? () => goTo(ch.spread!) : undefined}
                    title={jumpable ? "跳转到本章" : "演示原型：仅第一章可读"}
                    style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, padding: "7px 10px", borderRadius: 8, background: active ? "rgba(178,58,42,0.10)" : "transparent", cursor: jumpable ? "pointer" : "default" }}
                  >
                    <span style={{ fontFamily: "var(--font-mincho)", fontSize: 12, color: active ? "var(--acc)" : "var(--ink2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ch.label}</span>
                    <span style={{ fontSize: 10, color: active ? "var(--acc)" : "var(--ink2)", flex: "none", fontVariantNumeric: "tabular-nums" }}>{jumpable ? (active ? "在读" : "") : i === 0 ? ch.meta : "未读"}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ flex: "none", borderTop: "1px solid var(--line)", padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 11, color: "var(--ink2)" }}>生词本 <span style={{ color: "var(--acc)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{vocabCount}</span> 词</div>
            <div style={{ fontSize: 11, color: "var(--ink2)" }}>今日 23 分 · 连续 6 天</div>
          </div>
        </div>

        {/* 中栏 · 书页 */}
        <div style={{ flex: 1, minWidth: 0, position: "relative", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ flex: 1, overflow: "auto", display: "flex", alignItems: "center", justifyContent: "center", padding: "28px 64px 16px 64px", position: "relative" }}>
            <button onClick={prev} title="上一页（←）" style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", width: 40, height: 40, borderRadius: 999, border: "1px solid var(--line)", background: "var(--page)", color: "var(--ink2)", cursor: "pointer", fontSize: 15, opacity: spread === 0 ? 0.35 : 1, boxShadow: "0 4px 12px -4px rgba(50,35,15,0.25)" }}>‹</button>
            <button onClick={next} title="下一页（→）" style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", width: 40, height: 40, borderRadius: 999, border: "1px solid var(--line)", background: "var(--page)", color: "var(--ink2)", cursor: "pointer", fontSize: 15, opacity: spread === spreads.length - 1 ? 0.35 : 1, boxShadow: "0 4px 12px -4px rgba(50,35,15,0.25)" }}>›</button>

            <div style={{ position: "relative", maxWidth: 880, minWidth: 760, width: "100%" }}>
              <div style={{ position: "absolute", inset: 0, transform: "translate(5px,6px)", background: "var(--page)", borderRadius: 6, opacity: 0.55 }} />
              <div style={{ position: "absolute", inset: 0, transform: "translate(2px,3px)", background: "var(--page)", borderRadius: 6, opacity: 0.8 }} />
              <div style={{ position: "relative", display: "flex", alignItems: "stretch", background: "var(--page)", borderRadius: 6, boxShadow: "0 28px 64px -24px rgba(50,35,15,0.45)" }}>
                <div style={{ position: "absolute", top: 0, bottom: 0, left: "50%", width: 64, transform: "translateX(-50%)", background: "linear-gradient(90deg,rgba(60,45,25,0) 0%,rgba(60,45,25,0.09) 47%,rgba(60,45,25,0.15) 50%,rgba(60,45,25,0.09) 53%,rgba(60,45,25,0) 100%)", pointerEvents: "none", zIndex: 2 }} />

                {/* 左页 */}
                <div style={{ flex: 1, minWidth: 0, padding: "42px 46px 30px 44px", display: "flex", flexDirection: "column", minHeight: 600 }}>
                  {renderHead(sp.l)}
                  <div style={{ flex: 1 }}>{sp.l.ps.map(renderPara)}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 18 }}>
                    <span style={{ fontSize: 11, color: "var(--ink2)", fontVariantNumeric: "tabular-nums" }}>{sp.l.no}</span>
                    <span style={{ fontFamily: "var(--font-mincho)", fontSize: 10, color: "var(--ink2)", letterSpacing: 2, opacity: 0.7 }}>{meta.title}</span>
                  </div>
                </div>

                {/* 右页 */}
                <div style={{ flex: 1, minWidth: 0, padding: "42px 44px 30px 46px", display: "flex", flexDirection: "column", minHeight: 600 }}>
                  {renderHead(sp.r)}
                  <div style={{ flex: 1 }}>
                    {sp.r.ps.map(renderPara)}
                    {sp.r.illus && (
                      <div style={{ height: "100%", minHeight: 440, display: "flex", flexDirection: "column" }}>
                        <div style={{ flex: 1, border: "1px dashed var(--acc)", borderRadius: 10, background: "linear-gradient(170deg,rgba(39,53,79,0.06),rgba(178,58,42,0.04))", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 24, textAlign: "center" }}>
                          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--acc)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.9 5.8L20 10.7l-6.1 1.9L12 18.4l-1.9-5.8L4 10.7l6.1-1.9z" /><path d="M19 3l0.7 2.1L21.8 5.8l-2.1 0.7L19 8.6l-0.7-2.1L16.2 5.8l2.1-0.7z" /></svg>
                          <div style={{ fontFamily: "var(--font-mincho)", fontSize: 15, fontWeight: 600, color: "var(--ink)", letterSpacing: 1 }}>AI 插画 · 名场面</div>
                          <div style={{ fontSize: 12, color: "var(--ink2)", lineHeight: 1.8, maxWidth: 240 }}>「点名」— 基于本章文本与情绪曲线生成的轻小说风格插画将插入此处（概念位）</div>
                          <button style={{ cursor: "pointer", fontFamily: "inherit", fontSize: 11, letterSpacing: 1, padding: "7px 16px", borderRadius: 8, border: "1px solid var(--acc)", background: "transparent", color: "var(--acc)" }}>生成插画</button>
                        </div>
                        <div style={{ textAlign: "center", marginTop: 20, fontFamily: "var(--font-mincho)", color: "var(--ink2)", fontSize: 13, letterSpacing: 6 }}>✕ ✕ ✕</div>
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 18 }}>
                    <span style={{ fontFamily: "var(--font-mincho)", fontSize: 10, color: "var(--ink2)", letterSpacing: 2, opacity: 0.7 }}>{meta.chapterNo}</span>
                    <span style={{ fontSize: 11, color: "var(--ink2)", fontVariantNumeric: "tabular-nums" }}>{sp.r.no}</span>
                  </div>
                </div>
              </div>
            </div>

            {ambience && (
              <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(120% 90% at 50% 0%,rgba(24,38,70,0.20),rgba(24,38,70,0.05) 55%,rgba(178,58,42,0.03))", zIndex: 5 }}>
                <div style={{ position: "absolute", left: "24px", bottom: 18, display: "flex", alignItems: "center", gap: 8, background: "rgba(20,26,42,0.82)", color: "#D8DEF0", borderRadius: 999, padding: "7px 14px", fontSize: 11, letterSpacing: 1 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 99, background: "#8FB4FF", boxShadow: "0 0 8px rgba(143,180,255,0.9)" }} />
                  <span>氛围 · 星月夜 — 环境音《galaxy_night》试听中 · 概念演示</span>
                </div>
              </div>
            )}
          </div>

          {/* 底部进度 */}
          <div style={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 18, padding: "10px 24px 14px 24px" }}>
            <span style={{ fontSize: 11, color: "var(--ink2)", fontVariantNumeric: "tabular-nums" }}>{sp.l.no}–{sp.r.no} / {total}</span>
            <div style={{ width: 280, height: 3, borderRadius: 99, background: "var(--line)", position: "relative" }}>
              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${bookPct}%`, borderRadius: 99, background: "var(--acc)" }} />
              <div style={{ position: "absolute", left: `${bookPct}%`, top: -5, width: 2, height: 13, background: "var(--acc)", borderRadius: 2 }} />
            </div>
            <span style={{ fontSize: 11, color: "var(--ink2)" }}>全书 {bookPct}%</span>
            <span style={{ fontSize: 11, color: "var(--ink2)", opacity: 0.75 }}>点击段落显示译文 · 点击虚线词查词 · ← → 翻页</span>
          </div>
        </div>

        {/* 右栏 · AI 助手 */}
        <div style={{ width: 324, flex: "none", borderLeft: "1px solid var(--line)", display: "flex", flexDirection: "column", minHeight: 0, background: "var(--soft)" }}>
          <div style={{ flex: "none", padding: "14px 16px 0 16px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 2, color: "var(--ink)" }}>AI 阅读助手</div>
              <div style={{ fontSize: 10, color: "var(--acc)", border: "1px solid var(--acc)", borderRadius: 999, padding: "2px 8px", letterSpacing: 1, opacity: 0.85 }} title="所有 AI 功能只基于你已读到的位置，绝不剧透">防剧透 · 已读 {bookPct}%</div>
            </div>
            <div style={{ display: "flex", gap: 2, marginTop: 12 }}>
              {TABS.map((tb) => (
                <button key={tb.id} onClick={() => setTab(tb.id)} style={{ cursor: "pointer", flex: 1, fontFamily: "inherit", fontSize: 12, letterSpacing: 1, padding: "8px 0", background: "transparent", border: "none", borderBottom: `2px solid ${tb.id === tab ? "var(--acc)" : "transparent"}`, color: tb.id === tab ? "var(--acc)" : "var(--ink2)", fontWeight: tb.id === tab ? 700 : 400 }}>{tb.label}</button>
              ))}
            </div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: 16, borderTop: "1px solid var(--line)" }}>
            {tab === "chars" && (hasAI ? (
              <>
                <div style={{ fontSize: 10, color: "var(--ink2)", marginBottom: 8, letterSpacing: 1 }}>关系图随阅读进度生长 · 当前基于 p.12–17</div>
                <div style={{ background: "var(--page)", border: "1px solid var(--line)", borderRadius: 12, padding: 6 }}>
                  <svg viewBox="0 0 288 232" style={{ width: "100%", display: "block" }}>
                    {edges.map((e, i) => {
                      const mx = (e.a[0] + e.b[0]) / 2, my = (e.a[1] + e.b[1]) / 2;
                      return (
                        <g key={i}>
                          <line x1={e.a[0]} y1={e.a[1]} x2={e.b[0]} y2={e.b[1]} stroke="var(--line)" strokeWidth={1.5} />
                          <rect x={mx - 17} y={my - 8} width={34} height={16} rx={8} fill="var(--soft)" stroke="var(--line)" strokeWidth={1} />
                          <text x={mx} y={my + 3.5} textAnchor="middle" fontSize={9} fill="var(--ink2)">{e.label}</text>
                        </g>
                      );
                    })}
                    {nodes.map((n) => {
                      const sel = n.id === selChar;
                      return (
                        <g key={n.id} onClick={() => setSelChar(n.id)} style={{ cursor: "pointer" }}>
                          <circle cx={n.x} cy={n.y} r={21} fill="var(--page)" stroke={n.locked ? "var(--line)" : sel ? "var(--acc)" : "var(--ink2)"} strokeWidth={sel ? 2.5 : 1.5} strokeDasharray={n.locked ? "4 4" : "none"} />
                          <text x={n.x} y={n.y + 4} textAnchor="middle" fontSize={11} fontWeight={600} fill={n.locked ? "var(--ink2)" : sel ? "var(--acc)" : "var(--ink)"} fontFamily="var(--font-mincho)">{chars[n.id].glyph}</text>
                          <text x={n.x} y={n.y + 36} textAnchor="middle" fontSize={9.5} fill={sel ? "var(--acc)" : "var(--ink2)"}>{n.name}</text>
                        </g>
                      );
                    })}
                  </svg>
                </div>
                {chars[selChar] && (
                  <div style={{ marginTop: 12, background: "var(--page)", border: "1px solid var(--line)", borderRadius: 12, padding: 14 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontFamily: "var(--font-mincho)", fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>{chars[selChar].jp}</span>
                      <span style={{ fontSize: 11, color: "var(--ink2)" }}>{chars[selChar].zh}</span>
                      <span style={{ marginLeft: "auto", fontSize: 9, color: "var(--ink2)", border: "1px solid var(--line)", borderRadius: 4, padding: "1px 6px" }}>初登场 {chars[selChar].first}</span>
                    </div>
                    <p style={{ margin: "8px 0 0 0", fontSize: 12, lineHeight: 1.9, color: "var(--ink)", opacity: 0.85 }}>{chars[selChar].text}</p>
                  </div>
                )}
              </>
            ) : <Placeholder text="人物关系图谱将随阅读进度自动生长。导入书的图谱生成功能开发中。" />)}

            {tab === "enc" && (enc.length ? (
              <>
                <div style={{ fontSize: 10, color: "var(--ink2)", marginBottom: 8, letterSpacing: 1 }}>世界观词条按阅读进度自动解锁</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {enc.filter((e) => !e.locked).map((e, i) => (
                    <div key={i} style={{ background: "var(--page)", border: "1px solid var(--line)", borderRadius: 12, padding: "13px 14px" }}>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ fontFamily: "var(--font-mincho)", fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>{e.name}</span>
                        <span style={{ fontSize: 9, color: "var(--ink2)", fontVariantNumeric: "tabular-nums" }}>出处 {e.src}</span>
                      </div>
                      <p style={{ margin: "6px 0 0 0", fontSize: 12, lineHeight: 1.85, color: "var(--ink)", opacity: 0.82 }}>{e.text}</p>
                    </div>
                  ))}
                  {enc.filter((e) => e.locked).map((e, i) => (
                    <div key={i} style={{ border: "1px dashed var(--line)", borderRadius: 12, padding: "11px 14px", display: "flex", alignItems: "center", gap: 10, opacity: 0.75 }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--ink2)" strokeWidth="2" strokeLinecap="round"><rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
                      <span style={{ fontFamily: "var(--font-mincho)", fontSize: 13, color: "var(--ink2)" }}>{e.name}</span>
                      <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--ink2)" }}>{e.unlock}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : <Placeholder text="世界观百科会随阅读进度自动建条目并解锁。导入书功能开发中。" />)}

            {tab === "emo" && (hasAI ? (
              <>
                <div style={{ fontSize: 10, color: "var(--ink2)", marginBottom: 8, letterSpacing: 1 }}>第一章情绪曲线 · 未读部分已折叠</div>
                <div style={{ background: "var(--page)", border: "1px solid var(--line)", borderRadius: 12, padding: "12px 8px 4px 8px" }}>
                  <svg viewBox="0 0 288 120" style={{ width: "100%", display: "block" }}>
                    <line x1="0" y1="60" x2="288" y2="60" stroke="var(--line)" strokeWidth="1" strokeDasharray="3 4" />
                    <path d="M0,64 C20,60 40,55 62,52 C80,50 90,58 100,74 C108,88 114,94 120,91" fill="none" stroke="var(--acc)" strokeWidth="2.5" strokeLinecap="round" />
                    <path d="M120,91 C136,82 154,68 174,61 C204,50 234,58 260,54 C272,52 282,50 288,49" fill="none" stroke="var(--ink2)" strokeWidth="1.5" strokeDasharray="2 5" opacity="0.5" />
                    <line x1="120" y1="14" x2="120" y2="106" stroke="var(--acc)" strokeWidth="1" strokeDasharray="2 3" opacity="0.6" />
                    <text x="126" y="20" fontSize="9" fill="var(--acc)">当前位置</text>
                    <circle cx="86" cy="56" r="4" fill="var(--page)" stroke="var(--acc)" strokeWidth="2" />
                    <circle cx="106" cy="82" r="4" fill="var(--page)" stroke="var(--acc)" strokeWidth="2" />
                    <text x="8" y="14" fontSize="8.5" fill="var(--ink2)" letterSpacing="2">高</text>
                    <text x="8" y="112" fontSize="8.5" fill="var(--ink2)" letterSpacing="2">低</text>
                  </svg>
                </div>
                <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                  {[{ t: "ジョバンニ被点名", e: "紧张", p: "p.14 · 「あなたはわかっているのでしょう。」" }, { t: "ザネリ的嗤笑", e: "羞耻", p: "p.14 · 「くすっとわらいました」" }].map((m, i) => (
                    <div key={i} style={{ background: "var(--page)", border: "1px solid var(--line)", borderRadius: 12, padding: "11px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 99, background: "var(--acc)", flex: "none" }} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)" }}>{m.t} <span style={{ fontWeight: 400, color: "var(--ink2)" }}>· {m.e}</span></div>
                        <div style={{ fontSize: 10, color: "var(--ink2)" }}>{m.p}</div>
                      </div>
                    </div>
                  ))}
                  <div style={{ border: "1px dashed var(--line)", borderRadius: 12, padding: "10px 14px", fontSize: 11, color: "var(--ink2)", textAlign: "center" }}>后续 4 个名场面将随阅读解锁</div>
                </div>
              </>
            ) : <Placeholder text="情绪曲线与名场面会随阅读进度生成。导入书功能开发中。" />)}

            {tab === "qa" && (
              <>
                <div style={{ fontSize: 10, color: "var(--ink2)", marginBottom: 10, letterSpacing: 1, lineHeight: 1.7 }}>回答仅基于你已读到的位置（全书 {bookPct}%），不会剧透。</div>
                <input placeholder="问点什么…（回车提交）" onKeyDown={(e) => { if (e.key === "Enter" && e.currentTarget.value.trim()) { onQaCustom(e.currentTarget.value.trim()); e.currentTarget.value = ""; } }} style={{ width: "100%", boxSizing: "border-box", fontFamily: "inherit", fontSize: 12, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--page)", color: "var(--ink)", outline: "none" }} />
                {qa.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                    {qa.map((q) => (
                      <button key={q.id} onClick={() => { setQaId(q.id); setQaLive(null); }} style={{ cursor: "pointer", fontFamily: "inherit", fontSize: 11, padding: "6px 11px", borderRadius: 999, border: `1px solid ${q.id === qaId ? "var(--acc)" : "var(--line)"}`, background: q.id === qaId ? "var(--acc)" : "var(--page)", color: q.id === qaId ? "#FBF6EA" : q.spoiler ? "var(--ink2)" : "var(--ink)" }}>{q.q}</button>
                    ))}
                  </div>
                )}
                {(() => {
                  const preset = qaId ? qa.find((q) => q.id === qaId) : null;
                  if (preset) {
                    return (
                      <div style={{ marginTop: 12, background: "var(--page)", border: `1px solid ${preset.spoiler ? "var(--acc)" : "var(--line)"}`, borderRadius: 12, padding: 14 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 2, color: preset.spoiler ? "var(--acc)" : "var(--ink2)", marginBottom: 7 }}>{preset.spoiler ? "已拦截 · 涉及未读内容" : "AI 回答 · 仅基于已读"}</div>
                        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.95, color: "var(--ink)", opacity: 0.88 }}>{preset.a}</p>
                      </div>
                    );
                  }
                  if (qaLive) {
                    return (
                      <div style={{ marginTop: 12, background: "var(--page)", border: "1px solid var(--line)", borderRadius: 12, padding: 14 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 2, color: "var(--ink2)", marginBottom: 7 }}>AI 回答 · 仅基于已读{qaLive.loading ? " · 生成中…" : ""}</div>
                        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.95, color: "var(--ink)", opacity: 0.88 }}>{qaLive.text || "…"}</p>
                      </div>
                    );
                  }
                  return null;
                })()}
              </>
            )}

            {tab === "recap" && (
              <>
                <div style={{ fontSize: 10, color: "var(--ink2)", marginBottom: 8, letterSpacing: 1 }}>搁置再久，也能无痛续读</div>
                <div style={{ background: "var(--page)", border: "1px solid var(--line)", borderRadius: 12, padding: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <span style={{ fontFamily: "var(--font-mincho)", fontSize: 14, fontWeight: 600, color: "var(--acc)" }}>前情提要</span>
                    <span style={{ fontSize: 10, color: "var(--ink2)", marginLeft: "auto" }}>距上次阅读 12 天</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 12.5, lineHeight: 2.0, color: "var(--ink)", opacity: 0.88 }}>{recap || recapLive?.text || "点击下方按钮，基于你已读的内容生成无剧透前情提要。"}</p>
                  <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10, color: "var(--ink2)", background: "var(--soft)", border: "1px solid var(--line)", borderRadius: 4, padding: "2px 7px" }}>停在 {sp.l.no}–{sp.r.no}</span>
                    <span style={{ fontSize: 10, color: "var(--ink2)", background: "var(--soft)", border: "1px solid var(--line)", borderRadius: 4, padding: "2px 7px" }}>无剧透 · 仅复述已读</span>
                  </div>
                  {!recap && (
                    <button onClick={onRecap} disabled={recapLive?.loading} style={{ cursor: "pointer", width: "100%", marginTop: 14, fontFamily: "inherit", fontSize: 12, letterSpacing: 2, padding: "9px 0", borderRadius: 9, border: "none", background: "var(--acc)", color: "#FBF6EA" }}>{recapLive?.loading ? "生成中…" : "生成前情提要"}</button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 查词卡 */}
      {word && wc && (
        <div style={{ position: "fixed", left: wc.x, top: wc.y, width: 284, background: "var(--page)", border: "1px solid var(--line)", borderRadius: 14, boxShadow: "0 24px 56px -16px rgba(50,35,15,0.45)", padding: 16, zIndex: 80 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontFamily: "var(--font-mincho)", fontSize: 24, fontWeight: 600, color: "var(--ink)" }}>{word.w}</span>
            <span style={{ fontSize: 13, color: "var(--ink2)" }}>{word.k} · {word.r}</span>
            <button onClick={() => setWc(null)} title="关闭（Esc）" style={{ marginLeft: "auto", cursor: "pointer", border: "none", background: "transparent", color: "var(--ink2)", fontSize: 14, padding: 2 }}>✕</button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#FBF6EA", background: "var(--acc)", borderRadius: 4, padding: "2px 7px", letterSpacing: 1 }}>JLPT {word.n}</span>
            <span style={{ fontSize: 10, color: "var(--ink2)", border: "1px solid var(--line)", borderRadius: 4, padding: "2px 7px" }}>本书出现 {word.c} 次</span>
          </div>
          <div style={{ marginTop: 10, fontSize: 14, color: "var(--ink)" }}>{word.m}</div>
          <div style={{ marginTop: 8, fontSize: 11.5, lineHeight: 1.8, color: "var(--ink2)", borderTop: "1px solid var(--line)", paddingTop: 8 }}>{word.note}</div>
          <button onClick={() => { if (!saved[wc.key]) { setSaved((x) => ({ ...x, [wc.key]: true })); setVocabCount((v) => v + 1); } }} style={{ cursor: "pointer", width: "100%", marginTop: 12, fontFamily: "inherit", fontSize: 12, letterSpacing: 2, padding: "8px 0", borderRadius: 9, border: "1px solid var(--acc)", background: saved[wc.key] ? "transparent" : "var(--acc)", color: saved[wc.key] ? "var(--acc)" : "#FBF6EA" }}>{saved[wc.key] ? "已加入生词本 ✓" : "加入生词本"}</button>
        </div>
      )}
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <div style={{ border: "1px dashed var(--line)", borderRadius: 12, padding: "28px 18px", textAlign: "center", fontSize: 12, lineHeight: 1.9, color: "var(--ink2)" }}>{text}</div>
  );
}
