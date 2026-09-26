// 守卫测试 · 自带一个「非默认配置」的 dev server
// 运行：node scripts/guards.mjs
//
// e2e.mjs 跑的是本机默认配置（无口令、支付恒成功），下面这些分支只有换配置才走得到：
//   R-4  支付失败（PAY_MODE=MOCK_FAIL）→ 402，且不产生订单行
//   R-5  口令门失败限速 → 连续 5 次错误口令后 429
//   R-3  配了口令时未登录访问店员接口 → 401
//
// 脚本自己起 server（端口 3101）、跑完自己杀，不依赖外部环境。
//
// ⚠️ 跑之前必须先停掉别的 dev server：两个 next dev 共用同一个 .next 目录，
// 会互相覆盖构建产物，症状是**另一个 server 的页面开始 404 / 500**（实测过）。
// 所以本脚本启动前会检查 3000 端口，占用就直接拒绝运行而不是悄悄搞坏环境。

import { spawn, spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const PORT = 3101;
const BASE = `http://127.0.0.1:${PORT}`;
// 测试夹具：只喂给本进程临时起的那个 server，不是任何真实环境的凭据
const PASSCODE = "guards-only-passcode";
const prisma = new PrismaClient();

let pass = 0;
let fail = 0;

function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` —— ${detail}` : ""}`);
  }
}

async function waitForServer(timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/orders`, { signal: AbortSignal.timeout(3000) });
      if (res.status === 200) return true;
    } catch {
      // 还没起来，继续等
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/** 3000 端口上是否已经有 dev server（共用 .next 会互相破坏，必须拒绝并行） */
async function anotherServerRunning() {
  try {
    await fetch("http://127.0.0.1:3000/", { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log(`\n守卫测试 · 自带 server on :${PORT}\n`);

  if (await anotherServerRunning()) {
    console.error(
      "检测到 3000 端口上已有 dev server 在运行。\n" +
        "两个 next dev 共用同一个 .next 目录会互相破坏构建产物（页面会开始 404 / 500），\n" +
        "请先停掉它，再跑守卫测试。",
    );
    process.exitCode = 2;
    return;
  }

  const server = spawn(
    process.execPath,
    ["./node_modules/next/dist/bin/next", "dev", "-p", String(PORT)],
    {
      cwd: process.cwd(),
      env: { ...process.env, STAFF_PASSCODE: PASSCODE, PAY_MODE: "MOCK_FAIL" },
      stdio: "ignore",
    },
  );

  try {
    const ready = await waitForServer();
    check("独立 server 已就绪（配了口令 + 支付失败模式）", ready);
    if (!ready) return;

    // ---------- 口令门：配了口令就是严格模式 ----------
    console.log("\n[R-3] 口令门：未登录不得进入");
    const anon = await fetch(`${BASE}/api/staff/queue`);
    check("未登录访问队列返回 401", anon.status === 401, `实际 ${anon.status}`);

    const okLogin = await fetch(`${BASE}/api/staff/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode: PASSCODE }),
    });
    check("正确口令返回 200", okLogin.status === 200, `实际 ${okLogin.status}`);
    const cookie = (okLogin.headers.getSetCookie?.() ?? [])[0]?.split(";")[0] ?? "";
    check("登录后下发了会话 cookie", cookie.startsWith("staff_session="), cookie);
    const authed = await fetch(`${BASE}/api/staff/queue`, { headers: { cookie } });
    check("带会话可读队列（200）", authed.status === 200, `实际 ${authed.status}`);

    // ---------- R-5：限速 ----------
    console.log("\n[R-5] 口令爆破限速");
    const attempt = (passcode) =>
      fetch(`${BASE}/api/staff/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
    const wrongStatuses = [];
    for (let i = 0; i < 5; i++) wrongStatuses.push((await attempt("0000")).status);
    check(
      "连续 5 次错误口令均为 401",
      wrongStatuses.every((s) => s === 401),
      JSON.stringify(wrongStatuses),
    );
    const sixth = await attempt("0000");
    check("第 6 次被限速（429）", sixth.status === 429, `实际 ${sixth.status}`);
    const lockedCorrect = await attempt(PASSCODE);
    check(
      "锁定期间连正确口令也被拒绝（429）",
      lockedCorrect.status === 429,
      `实际 ${lockedCorrect.status}`,
    );
    const lockBody = await sixth.json().catch(() => ({}));
    check(
      "限速提示可读（含剩余分钟）",
      typeof lockBody.error === "string" && lockBody.error.includes("口令"),
      JSON.stringify(lockBody),
    );

    // ---------- R-4：支付失败 ----------
    console.log("\n[R-4] 支付失败（PAY_MODE=MOCK_FAIL）");
    const menu = await prisma.drink.findFirst({
      where: { available: true },
      orderBy: { sortOrder: "asc" },
    });
    const tail = "7070";
    const before = await prisma.order.count({ where: { phoneTail: tail } });
    const step = 5 * 60 * 1000;
    const arrival = new Date(Math.ceil((Date.now() + 15 * 60 * 1000) / step) * step);
    const paid = await fetch(`${BASE}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lines: [{ drinkId: menu.id, qty: 1 }],
        phoneTail: tail,
        arrivalAt: arrival.toISOString(),
        clientToken: `guards-${Date.now().toString(36)}`,
      }),
    });
    const payBody = await paid.json().catch(() => ({}));
    check("支付失败返回 402", paid.status === 402, `实际 ${paid.status}`);
    check(
      "失败原因可读且是中文",
      typeof payBody.error === "string" && payBody.error.includes("支付"),
      JSON.stringify(payBody),
    );
    check(
      "支付失败不产生订单行",
      (await prisma.order.count({ where: { phoneTail: tail } })) === before,
    );
  } finally {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      server.kill("SIGTERM");
    }
    await prisma.$disconnect();
  }

  console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项\n`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("守卫测试异常：", err);
  process.exitCode = 1;
});
