"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ShelfBook } from "@/lib/reader/types";

type Filter = "all" | "reading" | "unread" | "done";

const CHIPS: { f: Filter; label: string }[] = [
  { f: "all", label: "全部" },
  { f: "reading", label: "在读" },
  { f: "unread", label: "未读" },
  { f: "done", label: "读完" },
];

function statusOf(b: ShelfBook) {
  if (b.progLabel) return b.progLabel;
  if (b.prog === 0) return "未读";
  if (b.prog >= 100) return "已读完";
  return "在读 " + b.prog + "%";
}

export default function LibraryView({ books }: { books: ShelfBook[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const shown = useMemo(() => {
    const s = q.trim();
    return books.filter((b) => {
      if (filter === "reading" && !(b.prog > 0 && b.prog < 100)) return false;
      if (filter === "unread" && b.prog !== 0) return false;
      if (filter === "done" && b.prog < 100) return false;
      if (s && !(b.title + b.author).includes(s)) return false;
      return true;
    });
  }, [books, q, filter]);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append("files", f));
    setUploading(true);
    try {
      const res = await fetch("/api/books/import", { method: "POST", body: fd });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch (e) {
      alert("导入失败：" + (e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  const navigable = (b: ShelfBook) => b.cur || b.imported;

  return (
    <div
      data-theme="paper"
      style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--app)", fontFamily: "var(--font-serif)", overflow: "hidden" }}
    >
      {/* 顶栏 */}
      <div style={{ height: 56, flex: "none", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, padding: "0 20px", borderBottom: "1px solid var(--line)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, userSelect: "none", flex: "none" }}>
          <div style={{ width: 32, height: 32, borderRadius: 7, background: "var(--acc)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 6px rgba(178,58,42,0.35)" }}>
            <span style={{ color: "#FBF6EA", fontFamily: "var(--font-mincho)", fontSize: 16, fontWeight: 700 }}>読</span>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)", letterSpacing: 1.5 }}>Kreader</div>
            <div style={{ fontSize: 10, color: "var(--ink2)", letterSpacing: 3 }}>轻小说阅读器</div>
          </div>
        </div>
        <input
          placeholder="搜索书名 / 作者…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ width: 340, boxSizing: "border-box", fontFamily: "inherit", fontSize: 12.5, padding: "9px 14px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--page)", color: "var(--ink)", outline: "none" }}
        />
        <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => fileRef.current?.click()}
            style={{ cursor: "pointer", fontFamily: "inherit", fontSize: 12, letterSpacing: 1, padding: "8px 16px", borderRadius: 9, border: "none", background: "var(--acc)", color: "#FBF6EA" }}
          >
            {uploading ? "导入中…" : "导入书籍"}
          </button>
          <input ref={fileRef} type="file" accept=".epub,.txt" multiple hidden onChange={(e) => upload(e.target.files)} />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        <div style={{ maxWidth: 1180, margin: "0 auto", padding: "28px 40px 48px 40px" }}>
          {/* 继续阅读 */}
          <div style={{ background: "var(--page)", border: "1px solid var(--line)", borderRadius: 14, padding: 22, display: "flex", gap: 26, boxShadow: "0 14px 36px -18px rgba(50,35,15,0.3)" }}>
            <Link href="/read/ginga" title="打开《銀河鉄道の夜》" style={{ width: 134, height: 200, flex: "none", borderRadius: 6, background: "linear-gradient(160deg,#27354F,#101723)", boxShadow: "0 10px 22px -8px rgba(30,30,50,0.55)", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "14px 12px", textDecoration: "none" }}>
              <span style={{ writingMode: "vertical-rl", fontFamily: "var(--font-mincho)", fontSize: 15, color: "#EDE7D4", letterSpacing: 4, alignSelf: "flex-end" }}>銀河鉄道の夜</span>
              <span style={{ fontSize: 9.5, color: "rgba(237,231,212,0.65)" }}>宮沢賢治</span>
            </Link>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 3, color: "var(--acc)" }}>继续阅读</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
                <span style={{ fontFamily: "var(--font-mincho)", fontSize: 22, fontWeight: 600, color: "var(--ink)" }}>銀河鉄道の夜</span>
                <span style={{ fontSize: 12, color: "var(--ink2)" }}>宮沢賢治</span>
                <span style={{ fontSize: 9, letterSpacing: 1, padding: "2px 7px", borderRadius: 4, background: "var(--soft)", border: "1px solid var(--line)", color: "var(--ink2)" }}>EPUB · 日文</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
                <div style={{ width: 240, height: 3, borderRadius: 99, background: "var(--line)", position: "relative" }}>
                  <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "5%", borderRadius: 99, background: "var(--acc)" }} />
                </div>
                <span style={{ fontSize: 11, color: "var(--ink2)" }}>全书 5% · 第一章《午後の授業》38%</span>
              </div>
              <p style={{ margin: "12px 0 0 0", fontSize: 12.5, lineHeight: 1.95, color: "var(--ink2)", maxWidth: 560 }}>上回说到：银河课堂上，老师问「这白蒙蒙的银河究竟是什么」——被点名的乔班尼与康帕内拉都沉默了，扎内利在一旁嗤笑。</p>
              <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
                {["生词本 8 词", "人物图谱 4 +1", "百科词条 2 / 5"].map((t) => (
                  <span key={t} style={{ fontSize: 10, color: "var(--ink2)", background: "var(--soft)", border: "1px solid var(--line)", borderRadius: 4, padding: "2px 8px" }}>{t}</span>
                ))}
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                <Link href="/read/ginga" style={{ cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, letterSpacing: 2, padding: "9px 24px", borderRadius: 9, border: "none", background: "var(--acc)", color: "#FBF6EA", textDecoration: "none" }}>继续阅读</Link>
                <Link href="/read/ginga?tab=recap" style={{ cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, letterSpacing: 2, padding: "9px 18px", borderRadius: 9, border: "1px solid var(--acc)", background: "transparent", color: "var(--acc)", textDecoration: "none" }}>前情提要</Link>
              </div>
            </div>
          </div>

          {/* 书架 */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, margin: "32px 0 16px 0", flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: 2, color: "var(--ink)" }}>书架</span>
            <span style={{ fontSize: 11, color: "var(--ink2)" }}>{shown.length} 本</span>
            <div style={{ display: "flex", gap: 6 }}>
              {CHIPS.map((c) => {
                const on = c.f === filter;
                return (
                  <button key={c.f} onClick={() => setFilter(c.f)} style={{ cursor: "pointer", fontFamily: "inherit", fontSize: 11, padding: "5px 13px", borderRadius: 999, border: `1px solid ${on ? "var(--acc)" : "var(--line)"}`, background: on ? "var(--acc)" : "var(--page)", color: on ? "#FBF6EA" : "var(--ink2)" }}>{c.label}</button>
                );
              })}
            </div>
            <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--ink2)" }}>按最近阅读排序</span>
          </div>

          {shown.length === 0 && (
            <div style={{ border: "1px dashed var(--line)", borderRadius: 12, padding: 36, textAlign: "center", fontSize: 12, color: "var(--ink2)" }}>没有匹配的书。换个关键词，或清空筛选。</div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(148px,1fr))", gap: "26px 20px" }}>
            {shown.map((b) => {
              const badge = b.series || (b.imported ? "导入" : b.fmt === "TXT" ? "TXT" : "");
              const shadow = b.series
                ? "3px 3px 0 0 rgba(59,53,80,0.30), 6px 6px 0 0 rgba(59,53,80,0.15), 0 8px 18px -8px rgba(30,30,50,0.5)"
                : "0 8px 18px -8px rgba(30,30,50,0.5)";
              const reading = b.prog > 0 && b.prog < 100;
              const inner = (
                <>
                  <div style={{ position: "relative", aspectRatio: "2/3", borderRadius: 6, background: b.grad, boxShadow: shadow, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "12px 10px" }}>
                    <span style={{ writingMode: "vertical-rl", fontFamily: "var(--font-mincho)", fontSize: 13.5, letterSpacing: 3, color: "#EDE7D4", alignSelf: "flex-end", maxHeight: "75%", overflow: "hidden" }}>{b.title}</span>
                    <span style={{ fontSize: 9, color: "rgba(237,231,212,0.62)" }}>{b.author}</span>
                    {badge && <span style={{ position: "absolute", left: 8, top: 8, fontSize: 8.5, letterSpacing: 1, color: "#EDE7D4", background: "rgba(0,0,0,0.38)", borderRadius: 4, padding: "2px 6px" }}>{badge}</span>}
                  </div>
                  <div style={{ marginTop: 9 }}>
                    <div style={{ fontFamily: "var(--font-mincho)", fontSize: 12.5, fontWeight: 600, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.title}</div>
                    <div style={{ fontSize: 10.5, color: "var(--ink2)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.author} · {b.lang}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                      <div style={{ flex: 1, height: 3, borderRadius: 99, background: "var(--line)", position: "relative" }}>
                        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${b.prog}%`, borderRadius: 99, background: "var(--acc)" }} />
                      </div>
                      <span style={{ fontSize: 10, color: reading ? "var(--acc)" : "var(--ink2)", flex: "none", fontVariantNumeric: "tabular-nums" }}>{statusOf(b)}</span>
                    </div>
                  </div>
                </>
              );
              return navigable(b) ? (
                <Link key={b.id} href={`/read/${b.id}`} title={`打开《${b.title}》`} style={{ minWidth: 0, textDecoration: "none" }}>{inner}</Link>
              ) : (
                <div key={b.id} title="演示原型：内容未导入" style={{ minWidth: 0, cursor: "default" }}>{inner}</div>
              );
            })}

            {/* 导入位 */}
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); upload(e.dataTransfer.files); }}
              title="导入本地文件"
              style={{ minWidth: 0 }}
            >
              <div style={{ aspectRatio: "2/3", boxSizing: "border-box", border: `1.5px dashed ${dragOver ? "var(--acc)" : "var(--line)"}`, borderRadius: 8, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: dragOver ? "var(--acc)" : "var(--ink2)", cursor: "pointer" }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
                <span style={{ fontSize: 11, letterSpacing: 1 }}>导入 EPUB / TXT</span>
                <span style={{ fontSize: 9.5, opacity: 0.8 }}>或将文件拖到此处</span>
              </div>
            </div>
          </div>

          <div style={{ textAlign: "center", marginTop: 40, fontSize: 11, color: "var(--ink2)", letterSpacing: 1 }}>本月阅读 12.6 小时 · 读完 2 本 · 生词 132 · 连续 6 天</div>
        </div>
      </div>
    </div>
  );
}
