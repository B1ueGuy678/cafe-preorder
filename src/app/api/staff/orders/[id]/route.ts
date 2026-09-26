import { NextResponse } from "next/server";
import {
  DomainError,
  acceptOrder,
  markPickedUp,
  markReady,
  rejectOrder,
} from "@/lib/domain";
import { isStaffAuthed } from "@/lib/staff-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 店员操作订单。
 * action: accept 接单（AC-5）/ reject 拒单（AC-7）/ ready 已做好 / pickup 已取餐
 * 所有流转都经 domain 层的状态机校验，终态订单无法再次流转（AC-14）。
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    if (!(await isStaffAuthed())) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const action = body.action;

    switch (action) {
      case "accept": {
        const { order, prepMinutes } = await acceptOrder(id);
        return NextResponse.json({ order, prepMinutes });
      }
      case "reject": {
        const order = await rejectOrder(id, body.reason);
        return NextResponse.json({ order });
      }
      case "ready": {
        const order = await markReady(id);
        return NextResponse.json({ order });
      }
      case "pickup": {
        const order = await markPickedUp(id);
        return NextResponse.json({ order });
      }
      default:
        return NextResponse.json({ error: "未知操作" }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api/staff/orders/:id]", err);
    return NextResponse.json({ error: "服务器开小差了，请重试" }, { status: 500 });
  }
}
