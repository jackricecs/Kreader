// 防剧透「已读上下文」：服务端按段落全局序截断，只返回 globalIndex <= upto 的正文。
// 问答 / 提要 / 人物关系网共用——把"绝不传未读内容"的约束收在服务端，契合 prompts.ts 注释。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ bookId: string }> },
) {
  const { bookId } = await params;
  const uptoRaw = new URL(req.url).searchParams.get("upto");
  const upto = Number(uptoRaw);
  if (!Number.isInteger(upto) || upto < 0) {
    return NextResponse.json({ error: "upto 非法" }, { status: 400 });
  }

  const paras = await prisma.paragraph.findMany({
    where: { chapter: { bookId }, globalIndex: { lte: upto } },
    orderBy: { globalIndex: "asc" },
    select: { text: true },
  });

  return NextResponse.json({ text: paras.map((p) => p.text).join("\n") });
}
