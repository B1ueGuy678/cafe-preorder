// 店员端访问控制 · 阶段 2 最小实现
//
// 为什么必须有：`/staff` 能让任何人接单、拒单、暂停接单，并且会暴露顾客手机尾号。
// 没有这道门，AC-15（让陌生人在真实店里用）当天就会出事故。
//
// 这不是完整认证（没有账号体系、没有多角色），是一个**口令门**：
// 口令用环境变量 STAFF_PASSCODE 配置，通过 httpOnly cookie 记住会话。
// 阶段 3 若要做真账号，替换本文件即可，调用方无需改动。

import { cookies } from "next/headers";

const COOKIE_NAME = "staff_session";

/** 会话有效期：12 小时（一个营业日） */
const SESSION_MAX_AGE = 12 * 60 * 60;

// ---- 失败限速：防口令爆破（阶段 3 / R-5）----
// 口令只有 4 位数字量级的熵，不限速的话脚本几分钟就能试完。
// 计数放进程内存，重启即清零；单店单实例够用（见 docs/POLISH.md §5）
const MAX_FAILURES = 5;
const LOCK_MS = 5 * 60 * 1000;
const failures = new Map<string, { count: number; resetAt: number }>();

/** 该来源还剩多久解锁；返回 0 表示未被锁 */
export function lockRemainingMs(clientKey: string, now = Date.now()): number {
  const rec = failures.get(clientKey);
  if (!rec) return 0;
  if (now >= rec.resetAt) {
    failures.delete(clientKey);
    return 0;
  }
  return rec.count >= MAX_FAILURES ? rec.resetAt - now : 0;
}

function recordFailure(clientKey: string, now = Date.now()): void {
  const rec = failures.get(clientKey);
  if (!rec || now >= rec.resetAt) {
    failures.set(clientKey, { count: 1, resetAt: now + LOCK_MS });
    return;
  }
  rec.count += 1;
}

export function getStaffPasscode(): string | null {
  const code = process.env.STAFF_PASSCODE;
  return code && code.length > 0 ? code : null;
}

/** 未配置口令时的降级行为：开发环境放行，生产环境拒绝 */
function isConfigured(): boolean {
  return getStaffPasscode() !== null;
}

export async function isStaffAuthed(): Promise<boolean> {
  if (!isConfigured()) {
    // 生产环境绝不允许无口令进入；开发环境放行以便本地调试
    return process.env.NODE_ENV !== "production";
  }
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  return token === sessionToken();
}

/** 会话令牌：口令的简单派生，避免把口令本身写进 cookie */
function sessionToken(): string {
  const code = getStaffPasscode() ?? "";
  // 无需强密码学：这是单店口令门，不是用户凭证系统
  let hash = 0;
  for (let i = 0; i < code.length; i++) {
    hash = (hash * 31 + code.charCodeAt(i)) | 0;
  }
  return `s${Math.abs(hash).toString(36)}`;
}

export async function signInStaff(
  input: string,
  clientKey = "local",
): Promise<boolean> {
  const code = getStaffPasscode();
  if (!code) return process.env.NODE_ENV !== "production";
  if (input !== code) {
    recordFailure(clientKey);
    return false;
  }
  failures.delete(clientKey);
  const jar = await cookies();
  jar.set(COOKIE_NAME, sessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
    secure: process.env.NODE_ENV === "production",
  });
  return true;
}

export async function signOutStaff(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}
