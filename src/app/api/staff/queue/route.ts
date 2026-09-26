import { NextResponse } from "next/server";
import {
  DomainError,
  autoCancelStale,
  getQueue,
  setAccepting,
  updatePrepMinutes,
} from "@/lib/domain";
import { isStaffAuthed } from "@/lib/staff-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 店员端队列（AC-5 / AC-6）。
 * 队列按**到店时刻**排序，不是按下单时刻——这是本产品的核心机制。
 * 顺手执行超时自动取消（AC-8）。
 */
export async function GET() {
  try {
    if (!(await isStaffAuthed())) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    await autoCancelStale();
    const queue = await getQueue();
    return NextResponse.json(queue);
  } catch (err) {
    return errorResponse(err);
  }
}

/** 店员设置：暂停/恢复接单（AC-6）、制作时长 */
export async function POST(req: Request) {
  try {
    if (!(await isStaffAuthed())) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    if (typeof body.accepting === "boolean") {
      const shop = await setAccepting(body.accepting);
      return NextResponse.json({
        shop: { accepting: shop.accepting, prepMinutes: shop.prepMinutes },
      });
    }
    if (typeof body.prepMinutes === "number") {
      const shop = await updatePrepMinutes(body.prepMinutes);
      return NextResponse.json({
        shop: { accepting: shop.accepting, prepMinutes: shop.prepMinutes },
      });
    }
    return NextResponse.json({ error: "未知设置项" }, { status: 400 });
  } catch (err) {
    return errorResponse(err);
  }
}

function errorResponse(err: unknown) {
  if (err instanceof DomainError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[api/staff/queue]", err);
  return NextResponse.json({ error: "服务器开小差了，请重试" }, { status: 500 });
}
