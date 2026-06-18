"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { THEMES, type ThemeId } from "@/lib/theme/tokens";
import type {
  BookContent,
  BookShell,
  CharBio,
  CharEdge,
  CharNode,
  Para,
  Seg,
  Spread,
  SpreadSide,
} from "@/lib/reader/types";
import { paginateChapter } from "@/lib/reader/paginate";

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
interface GraphChar { id: string; name: string; glyph: string; desc: string; first: string }
interface GraphRel { a: string; b: string; label: string }
interface EncItem { name: string; category: string; desc: string; first: string }
interface SavedPos { chIdx: number; pi: number; scrollTop: number }
interface GraphData { nodes: CharNode[]; edges: CharEdge[]; chars: Record<string, CharBio> }

// 把示例书的全局跨页摊平成「单页」序列，丢掉末尾空白页。
function flattenSpreads(spreads: Spread[]): SpreadSide[] {
  const out: SpreadSide[] = [];
  for (const s of spreads) { out.push(s.l); out.push(s.r); }
  while (out.length > 1 && out[out.length - 1].ps.length === 0 && !out[out.length - 1].illus) out.pop();
  return out;
}

// 环形布局：把 AI 抽取的人物 / 关系摆到 288×232 画布的圆周上，复用现有 SVG 渲染。
function buildGraphLayout(characters: GraphChar[], relations: GraphRel[]): GraphData {
  const cx = 144, cy = 104;
  const R = characters.length <= 1 ? 0 : Math.min(80, 44 + characters.length * 6);
  const pos: Record<string, [number, number]> = {};
  const nodes: CharNode[] = characters.map((c, i) => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / characters.length;
    const x = characters.length === 1 ? cx : cx + R * Math.cos(ang);
    const y = characters.length === 1 ? cy : cy + R * Math.sin(ang);
    pos[c.id] = [x, y];
    return { id: c.id, x, y, name: c.name };
  });
  const chars: Record<string, CharBio> = {};
  for (const c of characters) {
    chars[c.id] = { jp: c.name, zh: c.desc, first: c.first || "已读", glyph: c.glyph || c.name.slice(0, 1), text: c.desc };
  }
  const edges: CharEdge[] = relations
    .filter((r) => pos[r.a] && pos[r.b])
    .map((r) => ({ a: pos[r.a], b: pos[r.b], label: r.label }));
  return { nodes, edges, chars };
}

export default function ReaderView({
  content,
  shell,
  initialTab,
}: {
  content?: BookContent;
  shell?: BookShell;
  initialTab?: string;
}) {
  const isSample = !!content;
  const meta = content ? content.meta : shell!.meta;
  const dict = content?.dict ?? {};
  const sampleQa = content?.qa ?? [];
  const enc = content?.enc ?? [];
  const sampleRecap = content?.recap ?? "";
  const router = useRouter();

  // 章节元信息：示例书视为「单章、全部已加载」；导入书来自 shell。
  const chapters = useMemo(() => {
    if (shell) return shell.toc;
    const count = content ? Object.keys(content.paras).length : 0;
    return [{ index: 0, title: meta.chapterTitle, paraCount: count }];
  }, [shell, content, meta.chapterTitle]);
  const totalParas = shell ? shell.totalParas : content ? Object.keys(content.paras).length : 0;
  // 各章起始的全局段落序（前缀和），用于防剧透截断。
  const chapterStart = useMemo(() => {
    const m: Record<number, number> = {};
    let acc = 0;
    for (const c of chapters) { m[c.index] = acc; acc += c.paraCount; }
    return m;
  }, [chapters]);

  // ── 位置与排版 ──
  const [chIdx, setChIdx] = useState(0);
  const [pi, setPi] = useState(0); // 章内页索引
  const [cols, setCols] = useState<1 | 2>(1); // 单页 / 双页
  const [chaptering, setChaptering] = useState(false);
  const [tab, setTab] = useState(initialTab && TABS.some((t) => t.id === initialTab) ? initialTab : "chars");
  const [biMode, setBiMode] = useState(false);
  const [ambience, setAmbience] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fs, setFs] = useState(19);
  const [lh, setLh] = useState(2.1);
  const [theme, setTheme] = useState<ThemeId>("paper");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [trans, setTrans] = useState<Record<string, TState>>({});
  const [wc, setWc] = useState<WC | null>(null);
  const [selChar, setSelChar] = useState(content?.nodes[0]?.id ?? "");
  const [qaId, setQaId] = useState<string | null>(null);
  const [qaLive, setQaLive] = useState<TState | null>(null);
  const [recapLive, setRecapLive] = useState<TState | null>(null);
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [vocabCount, setVocabCount] = useState(8);
  const [layout, setLayout] = useState<"page" | "scroll">("scroll"); // 默认滚动模式
  const [maxRead, setMaxRead] = useState(0); // 已读最远段落数（高水位）：驱动书架进度 + 防剧透 AI 上界

  // 已加载章节的页与段落（示例书初始即全量）。
  const [chapterPages, setChapterPages] = useState<Record<number, SpreadSide[]>>(
    (): Record<number, SpreadSide[]> => (content ? { 0: flattenSpreads(content.spreads) } : {}),
  );
  const [parasStore, setParasStore] = useState<Record<string, Para>>(() => (content ? content.paras : {}));
  const [chapterErr, setChapterErr] = useState<string | null>(null);
  const chapterPagesRef = useRef(chapterPages);
  useEffect(() => { chapterPagesRef.current = chapterPages; }, [chapterPages]);
  const loadingRef = useRef<Set<number>>(new Set());

  // ── 阅读位置记忆（按 bookId 存 localStorage，翻页 / 滚动通用）──
  const scrollRef = useRef<HTMLDivElement>(null);
  const draggedRef = useRef(false); // 刚发生拖拽滚动 → 抑制随后的 click（避免误触译文 / 查词）
  const readThumbRef = useRef<HTMLDivElement>(null); // 正文区悬浮进度丝（方案 C）
  const posKey = `kreader-pos-${meta.id}`;
  const restorePos = useRef<SavedPos | null>(null);
  const posReady = useRef(false); // 恢复完成或无需恢复后，才开始记录新位置

  // 排版偏好持久化（翻页 / 滚动；单页 / 双页）
  useEffect(() => {
    const l = window.localStorage.getItem("kreader-layout");
    if (l === "scroll" || l === "page") setLayout(l);
    const c = window.localStorage.getItem("kreader-cols");
    if (c === "1" || c === "2") setCols(Number(c) as 1 | 2);
  }, []);
  useEffect(() => { window.localStorage.setItem("kreader-layout", layout); }, [layout]);
  useEffect(() => { window.localStorage.setItem("kreader-cols", String(cols)); }, [cols]);
  // 双页对齐：切到双页时把奇数页索引归到偶数边。
  useEffect(() => { if (cols === 2 && pi % 2 === 1) setPi((p) => Math.max(0, p - 1)); }, [cols, pi]);

  // 进入时读取上次位置：先定位章节，pi / scrollTop 待章节加载后再落位。
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(posKey);
      if (raw) {
        const p = JSON.parse(raw) as Partial<SavedPos>;
        if (p && typeof p.chIdx === "number") {
          const ci = Math.min(Math.max(0, p.chIdx || 0), Math.max(0, chapters.length - 1));
          restorePos.current = { chIdx: ci, pi: p.pi || 0, scrollTop: p.scrollTop || 0 };
          if (ci) setChIdx(ci);
          return;
        }
      }
    } catch { /* 忽略损坏的本地数据 */ }
    posReady.current = true; // 无历史位置：直接允许记录
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posKey]);

  // 记录当前位置（翻页模式）。
  useEffect(() => {
    if (!posReady.current || layout !== "page") return;
    try { window.localStorage.setItem(posKey, JSON.stringify({ chIdx, pi, scrollTop: 0 })); } catch { /* 配额满等忽略 */ }
  }, [chIdx, pi, layout, posKey]);

  // 记录当前位置（滚动模式 · 单章）：节流写入当前章与章内 scrollTop。
  useEffect(() => {
    if (layout !== "scroll") return;
    const el = scrollRef.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      if (!posReady.current) return;
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        const cont = scrollRef.current;
        if (!cont) return;
        try { window.localStorage.setItem(posKey, JSON.stringify({ chIdx, pi: 0, scrollTop: cont.scrollTop })); } catch { /* 忽略 */ }
      }, 300);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => { el.removeEventListener("scroll", onScroll); if (t) clearTimeout(t); };
  }, [layout, posKey, chIdx]);

  // 滚动模式 · 正文区悬浮进度丝：滚动时浮现、停下淡出（隐藏原生条，方案 C）。
  useEffect(() => {
    if (layout !== "scroll") return;
    const el = scrollRef.current;
    const thumb = readThumbRef.current;
    if (!el || !thumb) return;
    let raf = 0;
    let fade: ReturnType<typeof setTimeout> | null = null;
    const paint = () => {
      raf = 0;
      const sh = el.scrollHeight, ch = el.clientHeight;
      if (sh <= ch) { thumb.style.opacity = "0"; return; }
      const h = Math.max(14, (ch / sh) * 100);
      const top = (el.scrollTop / (sh - ch)) * (100 - h);
      thumb.style.height = h + "%";
      thumb.style.top = top + "%";
    };
    const onScroll = () => {
      thumb.style.opacity = "0.85";
      if (fade) clearTimeout(fade);
      fade = setTimeout(() => { thumb.style.opacity = "0.32"; }, 800);
      if (!raf) raf = requestAnimationFrame(paint);
    };
    thumb.style.opacity = "0.32";
    paint();
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => paint());
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
      if (fade) clearTimeout(fade);
    };
  }, [layout, chapterPages]);

  // 滚动模式：按住正文拖拽滚动（同向 —— 向下拖 = 继续往下看，略带加速）。
  // 与点击译文 / 查词共存：超过阈值才算拖拽，拖拽后抑制随之而来的 click。
  useEffect(() => {
    if (layout !== "scroll") return;
    const el = scrollRef.current;
    if (!el) return;
    const SPEED = 1.6;   // 拖拽位移 → 滚动距离倍率，手感更"快"
    const THRESH = 6;    // 超过该位移才进入拖拽，避免误伤点击
    let down = false, dragging = false, startY = 0, startTop = 0;
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      // 不拦截按钮 / 链接等可交互控件
      if ((e.target as HTMLElement).closest("button,a,input,textarea")) return;
      down = true; dragging = false; startY = e.clientY; startTop = el.scrollTop;
    };
    const onMove = (e: MouseEvent) => {
      if (!down) return;
      const dy = e.clientY - startY;
      if (!dragging) {
        if (Math.abs(dy) < THRESH) return;
        dragging = true;
        el.style.cursor = "grabbing";
        el.style.userSelect = "none";
      }
      e.preventDefault(); // 抑制原生文本选择
      el.scrollTop = startTop + dy * SPEED;
    };
    const onUp = () => {
      if (!down) return;
      down = false;
      if (dragging) {
        draggedRef.current = true; // 抑制随后的 click
        el.style.cursor = "";
        el.style.userSelect = "";
        setTimeout(() => { draggedRef.current = false; }, 0);
      }
    };
    el.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove, { passive: false });
    window.addEventListener("mouseup", onUp);
    return () => {
      el.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [layout, chapterPages]);

  // ── 章节懒加载（导入书）──
  const loadChapter = useCallback(async (i: number) => {
    if (i < 0 || i >= chapters.length) return;
    if (chapterPagesRef.current[i] || loadingRef.current.has(i)) return;
    loadingRef.current.add(i);
    setChapterErr(null);
    try {
      const res = await fetch(`/api/books/${meta.id}/chapter/${i}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `${res.status}`);
      const raw = (data.paras ?? []) as { id: string; text: string; translation: string | null }[];
      const paras: Para[] = raw.map((p) => ({ id: p.id, segs: [{ t: p.text, plain: true }], zh: p.translation ?? undefined }));
      const cm = chapters.find((c) => c.index === i);
      const pages = paginateChapter(paras, cm?.title, i + 1);
      setParasStore((prev) => { const next = { ...prev }; for (const p of paras) next[p.id] = p; return next; });
      setChapterPages((prev) => ({ ...prev, [i]: pages }));
    } catch (e) {
      setChapterErr((e as Error).message);
    } finally {
      loadingRef.current.delete(i);
    }
  }, [chapters, meta.id]);

  // 进入 / 切换当前章时确保已加载，并后台预取下一章。
  useEffect(() => { if (!isSample) loadChapter(chIdx); }, [isSample, chIdx, loadChapter]);
  useEffect(() => { if (!isSample && chIdx + 1 < chapters.length) loadChapter(chIdx + 1); }, [isSample, chIdx, chapters.length, loadChapter]);

  // 章节加载到位后，落位到上次的页 / 滚动位置（一次性）。
  useEffect(() => {
    const rp = restorePos.current;
    if (!rp) return;
    if (layout === "page") {
      if (!(rp.chIdx in chapterPages)) return; // 等本章加载完
      const pgs = chapterPages[rp.chIdx];
      setPi(Math.min(rp.pi, pgs.length ? pgs.length - 1 : 0));
      restorePos.current = null;
      posReady.current = true;
      return;
    }
    // 滚动模式（单章）：本章加载完后落位到上次的章内 scrollTop。
    // 正文可能还没布局到位，直接设 scrollTop 会被浏览器夹到 0；轮询重试到生效或超时。
    if (!(rp.chIdx in chapterPages)) { loadChapter(rp.chIdx); return; }
    const target = rp.scrollTop;
    let tries = 0;
    const apply = () => {
      const el = scrollRef.current;
      if (el && target > 0) {
        el.scrollTop = target;
        if (Math.abs(el.scrollTop - target) > 1 && tries < 40) { tries++; setTimeout(apply, 50); return; }
      }
      restorePos.current = null;
      posReady.current = true;
    };
    apply();
  }, [chapterPages, layout, loadChapter]);

  // 滚动模式（单章）：切章后回到顶部（恢复历史位置时除外）。
  useEffect(() => {
    if (layout !== "scroll" || restorePos.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = 0;
  }, [chIdx, layout]);

  const pages = useMemo(() => chapterPages[chIdx] ?? [], [chapterPages, chIdx]);
  const pagesReady = chIdx in chapterPages;
  const left = pages[pi];
  const right = cols === 2 ? pages[pi + 1] : undefined;

  // 回到上一章时跳到该章末页（等加载完成后再定位）。
  const jumpEndRef = useRef(false);
  useEffect(() => {
    if (!jumpEndRef.current || !(chIdx in chapterPages)) return;
    const pgs = chapterPages[chIdx];
    const last = pgs.length ? (Math.ceil(pgs.length / cols) - 1) * cols : 0;
    setPi(Math.max(0, last));
    jumpEndRef.current = false;
  }, [chIdx, chapterPages, cols]);

  const next = useCallback(() => {
    setWc(null);
    const pgs = chapterPagesRef.current[chIdx] ?? [];
    if (pi + cols < pgs.length) { setPi(pi + cols); return; }
    if (chIdx + 1 < chapters.length) { setChIdx(chIdx + 1); setPi(0); }
  }, [chIdx, pi, cols, chapters.length]);
  const prev = useCallback(() => {
    setWc(null);
    if (pi - cols >= 0) { setPi(pi - cols); return; }
    if (pi > 0) { setPi(0); return; }
    if (chIdx > 0) { jumpEndRef.current = true; setChIdx(chIdx - 1); setPi(0); loadChapter(chIdx - 1); }
  }, [pi, cols, chIdx, loadChapter]);

  // 导入书目录跳转（翻页模式切到该章首页；滚动模式切到该章并回到顶部）
  const goToChapter = useCallback((i: number) => {
    if (i < 0 || i >= chapters.length) return;
    setWc(null); setChIdx(i); setPi(0); loadChapter(i);
    if (layout === "scroll") requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; });
  }, [chapters.length, loadChapter, layout]);
  const nextChapter = useCallback(() => goToChapter(chIdx + 1), [goToChapter, chIdx]);
  const prevChapter = useCallback(() => goToChapter(chIdx - 1), [goToChapter, chIdx]);
  // 示例书目录跳转（跨页索引 → 页索引）
  const goToSampleSpread = useCallback((spread: number) => { setWc(null); setPi(spread * 2); }, []);

  const atStart = chIdx === 0 && pi === 0;
  const atEnd = chIdx === chapters.length - 1 && pi + cols >= pages.length;

  // 当前所在章（示例书按跨页位置高亮；导入书即 chIdx）。
  const sampleCur = useMemo(() => {
    if (!content) return -1;
    let idx = -1;
    content.toc.forEach((c, i) => { if (typeof c.spread === "number" && c.spread <= Math.floor(pi / 2)) idx = i; });
    return idx;
  }, [content, pi]);

  // 已读段落数（到当前视图最后一页为止）与全书百分比。
  const visibleParas = useMemo(() => {
    let count = 0;
    if (layout === "scroll") {
      for (const pg of pages) count += pg.ps.length; // 单章滚动：整章视为已读窗口
      return count;
    }
    for (let k = 0; k <= pi + cols - 1 && k < pages.length; k++) count += pages[k].ps.length;
    return count;
  }, [pages, pi, cols, layout]);
  const readParas = (chapterStart[chIdx] ?? 0) + visibleParas;
  const bookPct = totalParas ? Math.min(100, Math.max(0, Math.round((readParas / totalParas) * 100))) : 0;
  const curChapterTitle = chapters[chIdx]?.title ?? meta.chapterNo;

  // 已读高水位（只增不减）：当前读到的位置推高 maxRead。
  // effectiveRead 同时驱动书架进度与防剧透 AI 上界 —— 回看前文不会让已生成的 AI 内容被判为剧透而隐藏。
  useEffect(() => { setMaxRead((m) => Math.max(m, readParas)); }, [readParas]);
  const effectiveRead = Math.max(maxRead, readParas);

  // 进入时从 DB 读历史进度（仅导入书）作为高水位起点：恢复书架进度与 AI 上界。
  useEffect(() => {
    if (isSample) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/books/${meta.id}/progress`);
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && typeof data.paragraphIdx === "number") {
          setMaxRead((m) => Math.max(m, data.paragraphIdx));
        }
      } catch { /* 离线 / 失败忽略 */ }
    })();
    return () => { cancelled = true; };
  }, [isSample, meta.id]);

  // 进度写回 DB（仅导入书，防抖）：驱动书架百分比 / 继续阅读，并稳定防剧透上界。
  useEffect(() => {
    if (isSample || maxRead <= 0) return;
    const pct = totalParas ? Math.min(100, Math.round((maxRead / totalParas) * 100)) : 0;
    const t = setTimeout(() => {
      fetch(`/api/books/${meta.id}/progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paragraphIdx: maxRead, percent: pct }),
      }).catch(() => { /* 失败忽略，下次再写 */ });
    }, 800);
    return () => clearTimeout(t);
  }, [isSample, maxRead, totalParas, meta.id]);

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
      if (layout === "page" && e.key === "ArrowRight") next();
      if (layout === "page" && e.key === "ArrowLeft") prev();
      if (e.key === "Escape") { setWc(null); setSettingsOpen(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, layout]);

  // 翻页模式：把书页等比缩放到正好容纳进可视区域。
  const fitAreaRef = useRef<HTMLDivElement>(null);
  const fitBookRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  useEffect(() => {
    if (layout !== "page") return;
    const area = fitAreaRef.current;
    const book = fitBookRef.current;
    if (!area || !book) return;
    const measure = () => {
      const availH = area.clientHeight - 44;
      const availW = area.clientWidth - 96;
      const natH = book.offsetHeight;
      const natW = book.offsetWidth;
      if (natH <= 0 || natW <= 0) return;
      setFit(Math.min(1, availH / natH, availW / natW));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(area);
    return () => ro.disconnect();
  }, [layout, chIdx, pi, cols, fs, lh, biMode, expanded, trans, pagesReady]);

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
    const para = parasStore[id];
    if (!para) return;
    if (expanded[id]) { setExpanded((x) => ({ ...x, [id]: false })); return; }
    setExpanded((x) => ({ ...x, [id]: true }));
    if (!para.zh && !trans[id]) fetchTranslate(id, para.segs.map((s) => s.t).join(""));
  };

  // 双语对照：自动翻译当前视图中无预置译文的段落
  useEffect(() => {
    if (!biMode) return;
    for (const id of [...(left?.ps ?? []), ...(right?.ps ?? [])]) {
      const para = parasStore[id];
      if (para && !para.zh && !trans[id]) fetchTranslate(id, para.segs.map((s) => s.t).join(""));
    }
  }, [biMode, left, right, parasStore, trans, fetchTranslate]);

  const onWord = (e: React.MouseEvent, key: string) => {
    e.stopPropagation();
    const x = Math.min(e.clientX - 30, window.innerWidth - 310);
    let y = e.clientY + 18;
    if (y > window.innerHeight - 300) y = e.clientY - 290;
    setWc({ key, x: Math.max(12, x), y: Math.max(12, y) });
  };

  // ── 已读上下文：导入书由服务端按全局段落序截断；示例书本地拼接 ──
  const getReadContext = useCallback(async (): Promise<string> => {
    if (isSample) {
      const ids: string[] = [];
      for (let k = 0; k <= pi + cols - 1 && k < pages.length; k++) ids.push(...pages[k].ps);
      return ids.map((id) => parasStore[id]?.segs.map((s) => s.t).join("")).filter(Boolean).join("\n");
    }
    const upto = effectiveRead - 1;
    if (upto < 0) return "";
    const res = await fetch(`/api/books/${meta.id}/context?upto=${upto}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error ?? "读取已读上下文失败");
    return (data.text as string) ?? "";
  }, [isSample, pi, cols, pages, parasStore, effectiveRead, meta.id]);

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

  const onQaCustom = async (q: string) => {
    setQaId(null);
    setQaLive({ loading: true, text: "" });
    try {
      const readContext = await getReadContext();
      await streamInto("/api/ai/qa", { question: q, readContext }, setQaLive);
    } catch (e) {
      setQaLive({ loading: false, text: "[失败] " + (e as Error).message });
    }
  };
  // 前情提要（带按进度缓存）。force=true 跳过缓存重新生成。
  const [recapUpto, setRecapUpto] = useState<number | null>(null);
  const [recapCached, setRecapCached] = useState(false);
  const recapStale = !!recapLive?.text && !recapLive.loading && recapUpto != null && effectiveRead - 1 > recapUpto;
  const onRecap = async (force = false) => {
    setRecapLive({ loading: true, text: "" });
    setRecapCached(false);
    try {
      const upto = effectiveRead - 1;
      const body = isSample || upto < 0 ? { readContext: await getReadContext() } : { bookId: meta.id, upto, force };
      const res = await fetch("/api/ai/recap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const rawUpto = res.headers.get("X-Recap-Upto");
      const hUpto = rawUpto ? Number(rawUpto) : NaN;
      setRecapUpto(Number.isInteger(hUpto) ? hUpto : upto >= 0 ? upto : null);
      setRecapCached(res.headers.get("X-Recap-Cached") === "1");
      if (!res.body) throw new Error("no stream");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setRecapLive({ loading: true, text: acc });
      }
      setRecapLive({ loading: false, text: acc });
    } catch (e) {
      setRecapLive({ loading: false, text: "[失败] " + (e as Error).message });
    }
  };

  // ── AI 人物关系网（导入书）·带缓存 ──
  const [graph, setGraph] = useState<{ characters: GraphChar[]; relations: GraphRel[] } | null>(null);
  const [graphUpto, setGraphUpto] = useState<number | null>(null); // 当前图谱基于的已读段落上界
  const [graphState, setGraphState] = useState<{ loading: boolean; err: string | null }>({ loading: false, err: null });
  // 读得比图谱生成位置更远 → 标记「可更新」，由用户决定是否花 token 重算。
  const graphStale = graph != null && graphUpto != null && effectiveRead - 1 > graphUpto;

  // 进入「人物」Tab 且内存无图谱时，先尝试命中服务端缓存（不调用模型）。
  // 记录上次尝试的 upto：高水位回填或继续阅读推高 upto 后会重试，避免缓存因首次 upto 偏小被永久跳过。
  const graphCacheTried = useRef(-1);
  useEffect(() => {
    if (isSample || tab !== "chars" || graph || graphState.loading) return;
    const upto = effectiveRead - 1;
    if (upto < 0 || upto <= graphCacheTried.current) return;
    graphCacheTried.current = upto;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/ai/chargraph?bookId=${meta.id}&upto=${upto}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled || !res.ok || !data.cached || !data.characters?.length) return;
        setGraph({ characters: data.characters, relations: data.relations ?? [] });
        setGraphUpto(data.upto ?? upto);
        setSelChar(data.characters[0].id);
      } catch {
        /* 缓存读取失败不打扰用户，按钮仍可手动生成 */
      }
    })();
    return () => { cancelled = true; };
  }, [isSample, tab, graph, graphState.loading, effectiveRead, meta.id]);

  const onGenGraph = async () => {
    setGraphState({ loading: true, err: null });
    try {
      const upto = effectiveRead - 1;
      if (isSample || upto < 0) { setGraphState({ loading: false, err: "还没读到正文，先往下读一点再生成" }); return; }
      const res = await fetch("/api/ai/chargraph", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookId: meta.id, upto }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `${res.status}`);
      if (!data.characters?.length) { setGraphState({ loading: false, err: "已读内容里还没识别到明确人物" }); return; }
      setGraph({ characters: data.characters, relations: data.relations ?? [] });
      setGraphUpto(upto);
      setSelChar(data.characters[0].id);
      setGraphState({ loading: false, err: null });
    } catch (e) {
      setGraphState({ loading: false, err: (e as Error).message });
    }
  };

  const graphData: GraphData | null = useMemo(() => {
    if (content) return { nodes: content.nodes, edges: content.edges, chars: content.chars };
    if (graph) return buildGraphLayout(graph.characters, graph.relations);
    return null;
  }, [content, graph]);
  const hasGraph = !!graphData && graphData.nodes.length > 0;
  useEffect(() => {
    if (graphData && graphData.nodes.length && !graphData.chars[selChar]) setSelChar(graphData.nodes[0].id);
  }, [graphData, selChar]);

  // ── AI 世界观百科（导入书）·带缓存（命中规则同人物关系网）──
  const [encData, setEncData] = useState<EncItem[] | null>(null);
  const [encUpto, setEncUpto] = useState<number | null>(null); // 当前百科基于的已读段落上界
  const [encState, setEncState] = useState<{ loading: boolean; err: string | null }>({ loading: false, err: null });
  const encStale = encData != null && encUpto != null && effectiveRead - 1 > encUpto;

  // 进入「百科」Tab 且内存无数据时，先尝试命中服务端缓存（不调用模型）。
  const encCacheTried = useRef(-1);
  useEffect(() => {
    if (isSample || tab !== "enc" || encData || encState.loading) return;
    const upto = effectiveRead - 1;
    if (upto < 0 || upto <= encCacheTried.current) return;
    encCacheTried.current = upto;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/ai/encyclopedia?bookId=${meta.id}&upto=${upto}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled || !res.ok || !data.cached || !data.entries?.length) return;
        setEncData(data.entries);
        setEncUpto(data.upto ?? upto);
      } catch { /* 缓存读取失败不打扰用户，按钮仍可手动生成 */ }
    })();
    return () => { cancelled = true; };
  }, [isSample, tab, encData, encState.loading, effectiveRead, meta.id]);

  const onGenEnc = async () => {
    setEncState({ loading: true, err: null });
    try {
      const upto = effectiveRead - 1;
      if (isSample || upto < 0) { setEncState({ loading: false, err: "还没读到正文，先往下读一点再生成" }); return; }
      const res = await fetch("/api/ai/encyclopedia", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookId: meta.id, upto }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `${res.status}`);
      if (!data.entries?.length) { setEncState({ loading: false, err: "已读内容里还没识别到明确世界观词条" }); return; }
      setEncData(data.entries);
      setEncUpto(upto);
      setEncState({ loading: false, err: null });
    } catch (e) {
      setEncState({ loading: false, err: (e as Error).message });
    }
  };

  const T = THEMES[theme];
  const rootVars = {
    "--app": T.app, "--page": T.page, "--ink": T.ink, "--ink2": T.ink2,
    "--line": T.line, "--acc": T.acc, "--soft": T.soft,
    "--fs": fs + "px", "--lh": String(lh),
  } as React.CSSProperties;

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
    const para = parasStore[id];
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

  const renderHead = (side: SpreadSide | undefined) => {
    if (!side?.head) return null;
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

  // 一页正文（章首标题 + 段落 + 插画概念位）
  const renderPageBody = (side: SpreadSide | undefined) => (
    <>
      {renderHead(side)}
      <div style={{ flex: 1 }}>
        {side?.ps.map(renderPara)}
        {side?.illus && (
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
    </>
  );

  const word = wc ? dict[wc.key] : null;

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
          <div style={{ fontSize: 11, color: "var(--ink2)", background: "var(--soft)", border: "1px solid var(--line)", padding: "3px 10px", borderRadius: 999, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{curChapterTitle}</div>
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
                <button onClick={() => setFs((v) => Math.min(28, v + 1))} style={{ cursor: "pointer", width: 28, height: 28, borderRadius: 7, border: "1px solid var(--line)", background: "transparent", color: "var(--ink)", fontFamily: "inherit", fontSize: 13 }}>A＋</button>
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
            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2.5, color: "var(--ink2)", marginBottom: 8 }}>翻页排布</div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => setCols(1)} title="一次显示一页 · 正文按真实字号、不缩小" style={{ cursor: "pointer", fontFamily: "inherit", fontSize: 11, padding: "5px 12px", borderRadius: 7, border: `1px solid ${cols === 1 ? "var(--acc)" : "var(--line)"}`, background: cols === 1 ? "var(--acc)" : "transparent", color: cols === 1 ? "#FBF6EA" : "var(--ink)" }}>单页</button>
                <button onClick={() => setCols(2)} title="一次显示两页（书本对开），整体会等比缩小" style={{ cursor: "pointer", fontFamily: "inherit", fontSize: 11, padding: "5px 12px", borderRadius: 7, border: `1px solid ${cols === 2 ? "var(--acc)" : "var(--line)"}`, background: cols === 2 ? "var(--acc)" : "transparent", color: cols === 2 ? "#FBF6EA" : "var(--ink)" }}>双页</button>
              </div>
            </div>
            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2.5, color: "var(--ink2)", marginBottom: 8 }}>模式</div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => setLayout("page")} title="翻页 · 自动缩放铺满，不上下滚动" style={{ cursor: "pointer", fontFamily: "inherit", fontSize: 11, padding: "5px 10px", borderRadius: 7, border: `1px solid ${layout === "page" ? "var(--acc)" : "var(--line)"}`, background: layout === "page" ? "var(--acc)" : "transparent", color: layout === "page" ? "#FBF6EA" : "var(--ink)" }}>翻页</button>
                <button onClick={() => setLayout("scroll")} title="单栏连续 · 像普通电子书一样向下滚动" style={{ cursor: "pointer", fontFamily: "inherit", fontSize: 11, padding: "5px 10px", borderRadius: 7, border: `1px solid ${layout === "scroll" ? "var(--acc)" : "var(--line)"}`, background: layout === "scroll" ? "var(--acc)" : "transparent", color: layout === "scroll" ? "#FBF6EA" : "var(--ink)" }}>滚动</button>
                <span title="开发中" style={{ fontSize: 11, padding: "5px 10px", borderRadius: 7, border: "1px dashed var(--line)", color: "var(--ink2)" }}>竖排 右→左</span>
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
              {!isSample && meta.fmt === "TXT" && chapters.length <= 1 && (
                <button onClick={onAutoChapter} disabled={chaptering} title="用 AI 把整篇无章节文本自动切分成章节" style={{ cursor: chaptering ? "default" : "pointer", fontFamily: "inherit", fontSize: 10, letterSpacing: 1, padding: "3px 8px", borderRadius: 6, border: "1px solid var(--acc)", background: "transparent", color: "var(--acc)", opacity: chaptering ? 0.6 : 1 }}>{chaptering ? "分章中…" : "AI 智能分章"}</button>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {isSample
                ? content!.toc.map((ch, i) => {
                    const jumpable = typeof ch.spread === "number";
                    const active = jumpable ? i === sampleCur : i === 0;
                    return (
                      <div key={i} onClick={jumpable ? () => goToSampleSpread(ch.spread!) : undefined} title={jumpable ? "跳转到本章" : "演示原型：仅第一章可读"} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, padding: "7px 10px", borderRadius: 8, background: active ? "rgba(178,58,42,0.10)" : "transparent", cursor: jumpable ? "pointer" : "default" }}>
                        <span style={{ fontFamily: "var(--font-mincho)", fontSize: 12, color: active ? "var(--acc)" : "var(--ink2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ch.label}</span>
                        <span style={{ fontSize: 10, color: active ? "var(--acc)" : "var(--ink2)", flex: "none", fontVariantNumeric: "tabular-nums" }}>{jumpable ? (active ? "在读" : "") : i === 0 ? ch.meta : "未读"}</span>
                      </div>
                    );
                  })
                : chapters.map((ch) => {
                    const active = ch.index === chIdx;
                    return (
                      <div key={ch.index} onClick={() => goToChapter(ch.index)} title="跳转到本章" style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, padding: "7px 10px", borderRadius: 8, background: active ? "rgba(178,58,42,0.10)" : "transparent", cursor: "pointer" }}>
                        <span style={{ fontFamily: "var(--font-mincho)", fontSize: 12, color: active ? "var(--acc)" : "var(--ink2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ch.title}</span>
                        <span style={{ fontSize: 10, color: active ? "var(--acc)" : "var(--ink2)", flex: "none", fontVariantNumeric: "tabular-nums" }}>{active ? "在读" : ""}</span>
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
          {layout === "page" ? (
            <div ref={fitAreaRef} style={{ flex: 1, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", padding: "28px 64px 16px 64px", position: "relative" }}>
              <button onClick={prev} title="上一页（←）" style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", width: 40, height: 40, borderRadius: 999, border: "1px solid var(--line)", background: "var(--page)", color: "var(--ink2)", cursor: "pointer", fontSize: 15, opacity: atStart ? 0.35 : 1, boxShadow: "0 4px 12px -4px rgba(50,35,15,0.25)", zIndex: 6 }}>‹</button>
              <button onClick={next} title="下一页（→）" style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", width: 40, height: 40, borderRadius: 999, border: "1px solid var(--line)", background: "var(--page)", color: "var(--ink2)", cursor: "pointer", fontSize: 15, opacity: atEnd ? 0.35 : 1, boxShadow: "0 4px 12px -4px rgba(50,35,15,0.25)", zIndex: 6 }}>›</button>

              {!pagesReady ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, color: "var(--ink2)" }}>
                  <div style={{ fontFamily: "var(--font-mincho)", fontSize: 15 }}>正在加载本章…</div>
                  {chapterErr && <div style={{ fontSize: 12, color: "var(--acc)" }}>加载失败：{chapterErr}<button onClick={() => loadChapter(chIdx)} style={{ marginLeft: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 11, padding: "3px 9px", borderRadius: 6, border: "1px solid var(--acc)", background: "transparent", color: "var(--acc)" }}>重试</button></div>}
                </div>
              ) : (
                <div ref={fitBookRef} style={{ position: "relative", maxWidth: cols === 2 ? 880 : 560, minWidth: cols === 2 ? 760 : 460, width: "100%", transform: `scale(${fit})`, transformOrigin: "center center" }}>
                  <div style={{ position: "absolute", inset: 0, transform: "translate(5px,6px)", background: "var(--page)", borderRadius: 6, opacity: 0.55 }} />
                  <div style={{ position: "absolute", inset: 0, transform: "translate(2px,3px)", background: "var(--page)", borderRadius: 6, opacity: 0.8 }} />
                  <div style={{ position: "relative", display: "flex", alignItems: "stretch", background: "var(--page)", borderRadius: 6, boxShadow: "0 28px 64px -24px rgba(50,35,15,0.45)" }}>
                    {cols === 2 && (
                      <div style={{ position: "absolute", top: 0, bottom: 0, left: "50%", width: 64, transform: "translateX(-50%)", background: "linear-gradient(90deg,rgba(60,45,25,0) 0%,rgba(60,45,25,0.09) 47%,rgba(60,45,25,0.15) 50%,rgba(60,45,25,0.09) 53%,rgba(60,45,25,0) 100%)", pointerEvents: "none", zIndex: 2 }} />
                    )}

                    {/* 左页（单页模式下即唯一页） */}
                    <div style={{ flex: 1, minWidth: 0, padding: cols === 2 ? "42px 46px 30px 44px" : "48px 56px 32px 56px", display: "flex", flexDirection: "column", minHeight: 600 }}>
                      {renderPageBody(left)}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 18 }}>
                        <span style={{ fontSize: 11, color: "var(--ink2)", fontVariantNumeric: "tabular-nums" }}>{left?.no ?? ""}</span>
                        <span style={{ fontFamily: "var(--font-mincho)", fontSize: 10, color: "var(--ink2)", letterSpacing: 2, opacity: 0.7 }}>{meta.title}</span>
                      </div>
                    </div>

                    {/* 右页（仅双页模式） */}
                    {cols === 2 && (
                      <div style={{ flex: 1, minWidth: 0, padding: "42px 44px 30px 46px", display: "flex", flexDirection: "column", minHeight: 600 }}>
                        {renderPageBody(right)}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 18 }}>
                          <span style={{ fontFamily: "var(--font-mincho)", fontSize: 10, color: "var(--ink2)", letterSpacing: 2, opacity: 0.7 }}>{curChapterTitle}</span>
                          <span style={{ fontSize: 11, color: "var(--ink2)", fontVariantNumeric: "tabular-nums" }}>{right?.no ?? ""}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {ambience && (
                <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(120% 90% at 50% 0%,rgba(24,38,70,0.20),rgba(24,38,70,0.05) 55%,rgba(178,58,42,0.03))", zIndex: 5 }}>
                  <div style={{ position: "absolute", left: "24px", bottom: 18, display: "flex", alignItems: "center", gap: 8, background: "rgba(20,26,42,0.82)", color: "#D8DEF0", borderRadius: 999, padding: "7px 14px", fontSize: 11, letterSpacing: 1 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 99, background: "#8FB4FF", boxShadow: "0 0 8px rgba(143,180,255,0.9)" }} />
                    <span>氛围 · 星月夜 — 环境音《galaxy_night》试听中 · 概念演示</span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
              <div ref={scrollRef} className="kr-reading" onClickCapture={(e) => { if (draggedRef.current) { e.stopPropagation(); e.preventDefault(); } }} style={{ position: "absolute", inset: 0, overflowY: "auto" }}>
                <div style={{ maxWidth: 720, margin: "0 auto", padding: "44px 44px 72px 44px" }}>
                  {!pagesReady ? (
                    <div style={{ textAlign: "center", padding: "72px 0", color: "var(--ink2)" }}>
                      <div style={{ fontFamily: "var(--font-mincho)", fontSize: 15 }}>正在加载本章…</div>
                      {chapterErr && <div style={{ marginTop: 10, fontSize: 12, color: "var(--acc)" }}>加载失败：{chapterErr}<button onClick={() => loadChapter(chIdx)} style={{ marginLeft: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 11, padding: "3px 9px", borderRadius: 6, border: "1px solid var(--acc)", background: "transparent", color: "var(--acc)" }}>重试</button></div>}
                    </div>
                  ) : (
                    <div id={`kr-ch-${chIdx}`}>
                      {pages.map((pg, k) => <Fragment key={k}>{renderHead(pg)}{pg.ps.map(renderPara)}</Fragment>)}
                      {/* 章末 · 上/下一章导航（按目录分章，不再一页到底） */}
                      <div style={{ marginTop: 44, paddingTop: 22, borderTop: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                        <button onClick={prevChapter} disabled={chIdx === 0} style={{ cursor: chIdx === 0 ? "default" : "pointer", fontFamily: "inherit", fontSize: 12, letterSpacing: 1, padding: "8px 16px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--page)", color: "var(--ink)", opacity: chIdx === 0 ? 0.4 : 1 }}>‹ 上一章</button>
                        <span style={{ fontSize: 11, color: "var(--ink2)", fontVariantNumeric: "tabular-nums" }}>第 {chIdx + 1}/{chapters.length} 章</span>
                        <button onClick={nextChapter} disabled={chIdx >= chapters.length - 1} style={{ cursor: chIdx >= chapters.length - 1 ? "default" : "pointer", fontFamily: "inherit", fontSize: 12, letterSpacing: 1, padding: "8px 16px", borderRadius: 8, border: `1px solid ${chIdx >= chapters.length - 1 ? "var(--line)" : "var(--acc)"}`, background: chIdx >= chapters.length - 1 ? "var(--page)" : "var(--acc)", color: chIdx >= chapters.length - 1 ? "var(--ink)" : "#FBF6EA", opacity: chIdx >= chapters.length - 1 ? 0.4 : 1 }}>下一章 ›</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {/* 方案 C · 正文区右缘悬浮进度丝（滚动时浮现、停下淡出） */}
              <div style={{ position: "absolute", top: 10, bottom: 10, right: 5, width: 3, borderRadius: 999, background: "color-mix(in srgb, var(--ink2) 16%, transparent)", pointerEvents: "none", zIndex: 4 }}>
                <div ref={readThumbRef} style={{ position: "absolute", left: 0, right: 0, top: 0, height: "20%", borderRadius: 999, background: "var(--acc)", opacity: 0.32, transition: "opacity 0.25s ease" }} />
              </div>
            </div>
          )}

          {/* 底部进度 */}
          <div style={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 18, padding: "10px 24px 14px 24px" }}>
            <span style={{ fontSize: 11, color: "var(--ink2)", fontVariantNumeric: "tabular-nums" }}>
              {chapters.length > 1 ? `第 ${chIdx + 1}/${chapters.length} 章 · ` : ""}{cols === 2 && right ? `p${left?.no ?? "–"}-${right.no}` : `p${left?.no ?? "–"}`}
            </span>
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
            {tab === "chars" && (
              <>
                {!isSample && (() => {
                  const filled = !graph || graphStale;
                  const label = graphState.loading ? "生成中…" : !graph ? "生成人物关系网" : graphStale ? "更新到最新进度" : "重新生成";
                  return (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <button onClick={onGenGraph} disabled={graphState.loading} style={{ cursor: graphState.loading ? "default" : "pointer", fontFamily: "inherit", fontSize: 11, letterSpacing: 1, padding: "6px 12px", borderRadius: 8, border: "1px solid var(--acc)", background: filled ? "var(--acc)" : "transparent", color: filled ? "#FBF6EA" : "var(--acc)", opacity: graphState.loading ? 0.6 : 1 }}>{label}</button>
                      <span style={{ fontSize: 10, color: graphStale ? "var(--acc)" : "var(--ink2)" }}>{graphStale ? "已读到更新位置 · 可刷新" : graph ? "已缓存 · 读到 " + bookPct + "%" : "基于已读 " + bookPct + "%"}</span>
                    </div>
                  );
                })()}
                {graphState.err && (
                  <div style={{ marginBottom: 10, fontSize: 11, color: "var(--acc)", background: "var(--page)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px" }}>{graphState.err}</div>
                )}
                {hasGraph ? (
                  <>
                    <div style={{ fontSize: 10, color: "var(--ink2)", marginBottom: 8, letterSpacing: 1 }}>
                      {isSample ? "关系图随阅读进度生长 · 当前基于 p.12–17" : "只含你已读到的人物 · 读得越多越完整"}
                    </div>
                    <div style={{ background: "var(--page)", border: "1px solid var(--line)", borderRadius: 12, padding: 6 }}>
                      <svg viewBox="0 0 288 232" style={{ width: "100%", display: "block" }}>
                        {graphData!.edges.map((e, i) => {
                          const mx = (e.a[0] + e.b[0]) / 2, my = (e.a[1] + e.b[1]) / 2;
                          return (
                            <g key={i}>
                              <line x1={e.a[0]} y1={e.a[1]} x2={e.b[0]} y2={e.b[1]} stroke="var(--line)" strokeWidth={1.5} />
                              <rect x={mx - 18} y={my - 8} width={36} height={16} rx={8} fill="var(--soft)" stroke="var(--line)" strokeWidth={1} />
                              <text x={mx} y={my + 3.5} textAnchor="middle" fontSize={9} fill="var(--ink2)">{e.label}</text>
                            </g>
                          );
                        })}
                        {graphData!.nodes.map((n) => {
                          const sel = n.id === selChar;
                          return (
                            <g key={n.id} onClick={() => setSelChar(n.id)} style={{ cursor: "pointer" }}>
                              <circle cx={n.x} cy={n.y} r={21} fill="var(--page)" stroke={n.locked ? "var(--line)" : sel ? "var(--acc)" : "var(--ink2)"} strokeWidth={sel ? 2.5 : 1.5} strokeDasharray={n.locked ? "4 4" : "none"} />
                              <text x={n.x} y={n.y + 4} textAnchor="middle" fontSize={11} fontWeight={600} fill={n.locked ? "var(--ink2)" : sel ? "var(--acc)" : "var(--ink)"} fontFamily="var(--font-mincho)">{graphData!.chars[n.id]?.glyph}</text>
                              <text x={n.x} y={n.y + 36} textAnchor="middle" fontSize={9.5} fill={sel ? "var(--acc)" : "var(--ink2)"}>{n.name}</text>
                            </g>
                          );
                        })}
                      </svg>
                    </div>
                    {graphData!.chars[selChar] && (
                      <div style={{ marginTop: 12, background: "var(--page)", border: "1px solid var(--line)", borderRadius: 12, padding: 14 }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                          <span style={{ fontFamily: "var(--font-mincho)", fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>{graphData!.chars[selChar].jp}</span>
                          <span style={{ fontSize: 11, color: "var(--ink2)" }}>{graphData!.chars[selChar].zh}</span>
                          <span style={{ marginLeft: "auto", fontSize: 9, color: "var(--ink2)", border: "1px solid var(--line)", borderRadius: 4, padding: "1px 6px" }}>初登场 {graphData!.chars[selChar].first}</span>
                        </div>
                        <p style={{ margin: "8px 0 0 0", fontSize: 12, lineHeight: 1.9, color: "var(--ink)", opacity: 0.85 }}>{graphData!.chars[selChar].text}</p>
                      </div>
                    )}
                  </>
                ) : (
                  !graphState.loading && !graphState.err && (
                    <Placeholder text={isSample ? "人物关系图谱将随阅读进度自动生长。" : "点上方「生成人物关系网」，AI 会基于你已读到的位置画出登场人物与关系，不剧透。"} />
                  )
                )}
              </>
            )}

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
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  {(() => {
                    const filled = !encData || encStale;
                    const label = encState.loading ? "生成中…" : !encData ? "生成世界观百科" : encStale ? "更新到最新进度" : "重新生成";
                    return (
                      <button onClick={onGenEnc} disabled={encState.loading} style={{ cursor: encState.loading ? "default" : "pointer", fontFamily: "inherit", fontSize: 11, letterSpacing: 1, padding: "6px 12px", borderRadius: 8, border: "1px solid var(--acc)", background: filled ? "var(--acc)" : "transparent", color: filled ? "#FBF6EA" : "var(--acc)", opacity: encState.loading ? 0.6 : 1 }}>{label}</button>
                    );
                  })()}
                  <span style={{ fontSize: 10, color: encStale ? "var(--acc)" : "var(--ink2)" }}>{encStale ? "已读到更新位置 · 可刷新" : encData ? "已缓存 · 读到 " + bookPct + "%" : "基于已读 " + bookPct + "%"}</span>
                </div>
                {encState.err && (
                  <div style={{ marginBottom: 10, fontSize: 11, color: "var(--acc)", background: "var(--page)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px" }}>{encState.err}</div>
                )}
                {encData && encData.length ? (
                  <>
                    <div style={{ fontSize: 10, color: "var(--ink2)", marginBottom: 8, letterSpacing: 1 }}>只含你已读到的世界观词条 · 读得越多越完整</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {encData.map((e, i) => (
                        <div key={i} style={{ background: "var(--page)", border: "1px solid var(--line)", borderRadius: 12, padding: "13px 14px" }}>
                          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                            <span style={{ fontFamily: "var(--font-mincho)", fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>{e.name}</span>
                            {e.category && <span style={{ fontSize: 9, color: "var(--acc)", border: "1px solid var(--acc)", borderRadius: 4, padding: "1px 6px", flex: "none" }}>{e.category}</span>}
                          </div>
                          <p style={{ margin: "6px 0 0 0", fontSize: 12, lineHeight: 1.85, color: "var(--ink)", opacity: 0.82 }}>{e.desc}</p>
                          {e.first && <div style={{ marginTop: 6, fontSize: 9.5, color: "var(--ink2)" }}>初登场 · {e.first}</div>}
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  !encState.loading && !encState.err && (
                    <Placeholder text="点上方「生成世界观百科」，AI 会基于你已读到的位置整理地名、组织、设定等词条，不剧透。" />
                  )
                )}
              </>
            ))}

            {tab === "emo" && (isSample ? (
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
                {sampleQa.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                    {sampleQa.map((q) => (
                      <button key={q.id} onClick={() => { setQaId(q.id); setQaLive(null); }} style={{ cursor: "pointer", fontFamily: "inherit", fontSize: 11, padding: "6px 11px", borderRadius: 999, border: `1px solid ${q.id === qaId ? "var(--acc)" : "var(--line)"}`, background: q.id === qaId ? "var(--acc)" : "var(--page)", color: q.id === qaId ? "#FBF6EA" : q.spoiler ? "var(--ink2)" : "var(--ink)" }}>{q.q}</button>
                    ))}
                  </div>
                )}
                {(() => {
                  const preset = qaId ? sampleQa.find((q) => q.id === qaId) : null;
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
                    <span style={{ fontSize: 10, color: "var(--ink2)", marginLeft: "auto" }}>读到 {bookPct}%{recapCached ? " · 缓存" : ""}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 12.5, lineHeight: 2.0, color: "var(--ink)", opacity: 0.88 }}>{sampleRecap || recapLive?.text || "点击下方按钮，基于你已读的内容生成无剧透前情提要。"}</p>
                  <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10, color: "var(--ink2)", background: "var(--soft)", border: "1px solid var(--line)", borderRadius: 4, padding: "2px 7px" }}>停在 {curChapterTitle}</span>
                    <span style={{ fontSize: 10, color: "var(--ink2)", background: "var(--soft)", border: "1px solid var(--line)", borderRadius: 4, padding: "2px 7px" }}>无剧透 · 仅复述已读</span>
                    {recapStale && <span style={{ fontSize: 10, color: "var(--acc)", background: "var(--soft)", border: "1px solid var(--acc)", borderRadius: 4, padding: "2px 7px" }}>已读到更新位置 · 可刷新</span>}
                  </div>
                  {!sampleRecap && (() => {
                    const has = !!recapLive?.text && !recapLive.loading;
                    const label = recapLive?.loading ? "生成中…" : !has ? "生成前情提要" : recapStale ? "更新前情提要" : "重新生成";
                    const filled = !has || recapStale;
                    return (
                      <button onClick={() => onRecap(has)} disabled={recapLive?.loading} style={{ cursor: recapLive?.loading ? "default" : "pointer", width: "100%", marginTop: 14, fontFamily: "inherit", fontSize: 12, letterSpacing: 2, padding: "9px 0", borderRadius: 9, border: "1px solid var(--acc)", background: filled ? "var(--acc)" : "transparent", color: filled ? "#FBF6EA" : "var(--acc)" }}>{label}</button>
                    );
                  })()}
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
