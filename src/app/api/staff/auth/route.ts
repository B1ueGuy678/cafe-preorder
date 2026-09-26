import { NextResponse } from "next/server";
import { DomainError } from "@/lib/domain";
import { clientKeyOf, readJsonObject } from "@/lib/http";
import { lockRemainingMs, signInStaff, signOutStaff } from "@/lib/staff-auth";

export const runtime = "nodejs";

/**
 * 店员登录（口令门）。口令来自环境变量 STAFF_PASSCODE，永不硬编码。
 *
 * 限速（阶段 3 / R-5）：连续 5 次错误口令后锁定 5 分钟。
 * 口令的熵很低，不限速的话脚本几分钟就能试完，这道门等于没有。
 */
export async function POST(req: Request) {
  try {
    const body = await readJsonObject(req);

    if (body.action === "signout") {
      await signOutStaff();
      return NextResponse.json({ ok: true });
    }

    const clientKey = clientKeyOf(req);
    const lockedMs = lockRemainingMs(clientKey);
    if (lockedMs > 0) {
      return NextResponse.json(
        {
          error: `口令尝试次数过多，请 ${Math.max(1, Math.ceil(lockedMs / 60000))} 分钟后再试`,
        },
        { status: 429 },
      );
    }

    const ok = await signInStaff(String(body.passcode ?? ""), clientKey);
    if (!ok) {
      return NextResponse.json({ error: "口令不正确" }, { status: 401 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api/staff/auth]", err);
    return NextResponse.json({ error: "服务器开小差了，请重试" }, { status: 500 });
  }
}
