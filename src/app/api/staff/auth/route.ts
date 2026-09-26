import { NextResponse } from "next/server";
import { signInStaff, signOutStaff } from "@/lib/staff-auth";

export const runtime = "nodejs";

/** 店员登录（口令门）。口令来自环境变量 STAFF_PASSCODE，永不硬编码。 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  if (body.action === "signout") {
    await signOutStaff();
    return NextResponse.json({ ok: true });
  }

  const ok = await signInStaff(String(body.passcode ?? ""));
  if (!ok) {
    return NextResponse.json({ error: "口令不正确" }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
