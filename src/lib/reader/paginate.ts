// 客户端可用的「单章分页」。从 build.ts 的全局分页拆出：对一章段落按字符预算
// 切成「单页」数组（每页一个 SpreadSide），首页带章首大标题。
//
// 关键性质：原全局分页本就在每章首段强制换页，故「逐章独立分页」与「全局分页」
// 结果一致 —— 懒加载按章拉取、按章分页，不改变任何排版。
import type { Para, SpreadSide } from "./types";

export const CHARS_PER_PAGE = 560; // 单页字符预算（贴合单屏页高，翻页模式几乎无需缩放）

/** 把一章的段落切成单页数组。pageNo 为页码（1 起，章内相对）。 */
export function paginateChapter(
  paras: Para[],
  headTitle?: string,
  headNo?: number,
): SpreadSide[] {
  const pages: SpreadSide[] = [];
  let cur: string[] = [];
  let budget = 0;

  const flush = () => {
    if (!cur.length) return;
    const first = pages.length === 0;
    pages.push({
      no: pages.length + 1,
      head: first,
      headTitle: first ? headTitle : undefined,
      headNo: first ? headNo : undefined,
      ps: cur,
    });
    cur = [];
    budget = 0;
  };

  for (const p of paras) {
    const len = p.segs.reduce((n, s) => n + s.t.length, 0);
    if (cur.length && budget + len > CHARS_PER_PAGE) flush();
    cur.push(p.id);
    budget += len;
  }
  flush();

  // 空章也给一页，避免下游取 pages[0] 为 undefined。
  return pages.length ? pages : [{ no: 1, head: true, headTitle, headNo, ps: [] }];
}
