import { NextResponse } from "next/server";
import { DomainError, autoCancelStale, createOrder } from "@/lib/domain";
import { readJsonObject } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET：顾客端可选的到店时刻 + 店铺状态（AC-2 / AC-9） */
export async function GET() {
  const { getArrivalOptions } = await import("@/lib/domain");
  try {
    // 顺手清理超时未接单的订单（AC-8）
    await autoCancelStale();
    const data = await getArrivalOptions();
    return NextResponse.json(data);
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST：下单（AC-1 / AC-2 / AC-9） */
export async function POST(req: Request) {
  try {
    const body = await readJsonObject(req);
    const { order, reused } = await createOrder({
      lines: body.lines,
      phoneTail: body.phoneTail,
      arrivalAt: body.arrivalAt,
      customerName: body.customerName,
      note: body.note,
      clientToken: body.clientToken,
    });
    // 同一 clientToken 的重复提交返回 200 与**同一张**订单，前端无需区分（R-2）
    return NextResponse.json({ order, reused }, { status: reused ? 200 : 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

function errorResponse(err: unknown) {
  if (err instanceof DomainError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[api/orders]", err);
  return NextResponse.json({ error: "服务器开小差了，请重试" }, { status: 500 });
}
