import { NextResponse } from "next/server";
import {
  DomainError,
  autoCancelStale,
  cancelByCustomer,
  expectedReadyAt,
  getOrder,
  requestHold,
} from "@/lib/domain";
import { AUTO_CANCEL_MS, FREE_CANCEL_MS } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 顾客端订单详情（AC-3 / AC-11）。
 * 每次查询顺手清理超时未接单订单（AC-8 的触发点，无需后台任务）。
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await autoCancelStale();
    const order = await getOrder(id);

    // 把「还能免费取消多久」「还剩多久被自动取消」算好给前端，避免前端各算一遍
    const now = Date.now();
    const freeCancelDeadline =
      order.paidAt && !isTerminal(order.status)
        ? new Date(order.paidAt.getTime() + FREE_CANCEL_MS)
        : null;
    const autoCancelDeadline =
      order.status === "PENDING" && order.paidAt
        ? new Date(order.paidAt.getTime() + AUTO_CANCEL_MS)
        : null;

    return NextResponse.json({
      order,
      expectedReadyAt: expectedReadyAt(order).toISOString(),
      freeCancelDeadline: freeCancelDeadline?.toISOString() ?? null,
      autoCancelDeadline: autoCancelDeadline?.toISOString() ?? null,
      serverNow: new Date(now).toISOString(),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/** 顾客操作：取消订单（AC-4）/ 我快到了（AC-12） */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const action = body.action;

    if (action === "cancel") {
      const order = await cancelByCustomer(id);
      return NextResponse.json({ order });
    }
    if (action === "hold") {
      const order = await requestHold(id);
      return NextResponse.json({ order });
    }
    return NextResponse.json({ error: "未知操作" }, { status: 400 });
  } catch (err) {
    return errorResponse(err);
  }
}

function isTerminal(status: string) {
  return status === "PICKED_UP" || status === "CANCELED";
}

function errorResponse(err: unknown) {
  if (err instanceof DomainError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[api/orders/:id]", err);
  return NextResponse.json({ error: "服务器开小差了，请重试" }, { status: 500 });
}
