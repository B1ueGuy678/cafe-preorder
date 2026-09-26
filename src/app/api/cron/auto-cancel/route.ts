import { NextResponse } from "next/server";
import { autoCancelStale } from "@/lib/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 兜底清理：把超过 3 分钟未接单的订单自动取消并退款（AC-8）。
 *
 * 主力机制仍然是「有请求就顺手清理」——顾客端轮询、店员台刷新都会触发
 * （见 docs/ARCHITECTURE.md §5）。这个端点是给「整晚没人访问」兜底的，
 * 因为 Vercel Hobby 的 Cron 每天只能跑一次，它顶多算保险，不是主力。
 *
 * 保护方式：必须带 Authorization: Bearer $CRON_SECRET。
 * 未配置 CRON_SECRET 时直接 503 禁用——部署时忘了配 secret 也不会敞着一个
 * 能被外人随手触发的写端点。
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "未配置 CRON_SECRET，端点已禁用" },
      { status: 503 },
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const result = await autoCancelStale();
  return NextResponse.json({ ok: true, ...result, at: new Date().toISOString() });
}
