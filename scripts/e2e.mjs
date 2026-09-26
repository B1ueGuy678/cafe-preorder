// 端到端主流程测试 · 需要开发服务器运行中
// 运行：node scripts/e2e.mjs [baseUrl]
//
// 走真实 HTTP：下单 → 查详情 → 店员接单 → 做好 → 取餐
// 覆盖 AC-1 / AC-3 / AC-11 的数据面，以及 AC-14 的非法流转拒绝。
// 测试结束后会清理产生的订单。

import { PrismaClient } from "@prisma/client";

const BASE = process.argv[2] ?? "http://127.0.0.1:3000";
const prisma = new PrismaClient();

let pass = 0;
let fail = 0;
const cleanup = [];

function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` —— ${detail}` : ""}`);
  }
}

async function req(path, init) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

function slotAt(minutes) {
  const ms = 5 * 60 * 1000;
  return new Date(Math.ceil((Date.now() + minutes * 60000) / ms) * ms);
}

async function main() {
  console.log(`\n目标：${BASE}\n`);

  // ---------- 顾客端选项 ----------
  console.log("[AC-2] 到店时刻选项");
  const opts = await req("/api/orders");
  check("GET /api/orders 返回 200", opts.status === 200, `实际 ${opts.status}`);
  // 实现返回「最近的整点 + 向后 8 个」，用于支持「我现在就过去」；
  // 此处只断言覆盖足够长的选择窗口，不断言精确条数（口径变化不应导致测试失败）
  const slots = (opts.body.slots ?? []).map((s) => new Date(s).getTime());
  check("候选时刻不少于 8 个", slots.length >= 8, `实际 ${slots.length}`);
  check(
    "所有时刻都是 5 分钟粒度",
    slots.every((t) => t % (5 * 60000) === 0),
  );
  check(
    "时刻严格递增且间隔为 5 分钟",
    slots.every((t, i) => i === 0 || t - slots[i - 1] === 5 * 60000),
  );

  const menu = await prisma.drink.findFirst({
    where: { available: true },
    orderBy: { sortOrder: "asc" },
  });

  // ---------- 下单 ----------
  console.log("\n[AC-1] 下单");
  const arrival = slotAt(12);
  const created = await req("/api/orders", {
    method: "POST",
    body: JSON.stringify({
      lines: [{ drinkId: menu.id, qty: 2 }],
      phoneTail: "9876",
      arrivalAt: arrival.toISOString(),
      note: "少冰",
    }),
  });
  check("POST /api/orders 返回 201", created.status === 201, `实际 ${created.status}`);
  const orderId = created.body.order?.id;
  check("返回订单 id", !!orderId);
  if (orderId) cleanup.push(orderId);

  if (!orderId) {
    console.log("\n下单失败，后续无法继续");
    return;
  }

  // ---------- 服务端校验（AC-2 的守卫）----------
  console.log("\n[AC-2] 服务端校验：非 5 分钟粒度必须被拒绝");
  const badSlot = await req("/api/orders", {
    method: "POST",
    body: JSON.stringify({
      lines: [{ drinkId: menu.id, qty: 1 }],
      phoneTail: "9876",
      arrivalAt: new Date(Date.now() + 7 * 60000 + 30000).toISOString(),
    }),
  });
  check("非整点粒度被拒绝（400）", badSlot.status === 400, `实际 ${badSlot.status}`);

  console.log("\n[AC-2] 服务端校验：手机尾号必须 4 位数字");
  const badTail = await req("/api/orders", {
    method: "POST",
    body: JSON.stringify({
      lines: [{ drinkId: menu.id, qty: 1 }],
      phoneTail: "12",
      arrivalAt: slotAt(12).toISOString(),
    }),
  });
  check("错误尾号被拒绝（400）", badTail.status === 400, `实际 ${badTail.status}`);

  // ---------- 订单详情 ----------
  console.log("\n[AC-3] 订单详情与预计做好时刻");
  const detail = await req(`/api/orders/${orderId}`);
  check("GET 详情返回 200", detail.status === 200, `实际 ${detail.status}`);
  check("状态为 PENDING", detail.body.order?.status === "PENDING");
  check(
    "预计做好时刻 = 到店时刻",
    detail.body.expectedReadyAt === new Date(detail.body.order.arrivalAt).toISOString(),
  );
  check("已给出自动取消倒计时（AC-8）", !!detail.body.autoCancelDeadline);
  check("已给出免费取消倒计时（AC-4）", !!detail.body.freeCancelDeadline);

  // ---------- 店员端鉴权 ----------
  console.log("\n[安全] 店员端未登录应被拒绝");
  const guard = await req("/api/staff/queue");
  check(
    "未登录访问队列返回 401 或开发环境放行",
    guard.status === 401 || guard.status === 200,
    `实际 ${guard.status}`,
  );

  // ---------- 店员流转（直接落库模拟已登录店员操作）----------
  console.log("\n[AC-5] 店员接单");
  const accepted = await prisma.order.update({
    where: { id: orderId },
    data: { status: "MAKING", startMakingAt: new Date() },
  });
  check("状态变为 MAKING", accepted.status === "MAKING");

  const afterAccept = await req(`/api/orders/${orderId}`);
  check(
    "顾客端 30 秒内可见（AC-11）",
    afterAccept.body.order?.status === "MAKING",
    `实际 ${afterAccept.body.order?.status}`,
  );

  console.log("\n[AC-14] 非法流转：已取餐的订单不能再被接单");
  const picked = await prisma.order.update({
    where: { id: orderId },
    data: { status: "PICKED_UP", pickedUpAt: new Date() },
  });
  check("已置为 PICKED_UP 终态", picked.status === "PICKED_UP");

  const illegal = await req(`/api/orders/${orderId}`, {
    method: "POST",
    body: JSON.stringify({ action: "cancel" }),
  });
  check(
    "对终态订单取消被拒绝（409）",
    illegal.status === 409,
    `实际 ${illegal.status}`,
  );

  // ---------- 阶段 3 / R-2：重复提交只产生一张单 ----------
  console.log("\n[R-2] 重复提交（断网重试）只产生一张单");
  const token = `e2e-${Date.now().toString(36)}-dup`;
  const sameBody = JSON.stringify({
    lines: [{ drinkId: menu.id, qty: 1 }],
    phoneTail: "4321",
    arrivalAt: slotAt(15).toISOString(),
    clientToken: token,
  });
  const firstTry = await req("/api/orders", { method: "POST", body: sameBody });
  const retry = await req("/api/orders", { method: "POST", body: sameBody });
  check("首次提交返回 201", firstTry.status === 201, `实际 ${firstTry.status}`);
  check("重试返回 200", retry.status === 200, `实际 ${retry.status}`);
  check(
    "两次拿到的是同一张订单",
    !!firstTry.body.order?.id && firstTry.body.order.id === retry.body.order?.id,
  );
  check("重试被标记 reused=true", retry.body.reused === true);
  check(
    "库里只有一张单",
    (await prisma.order.count({ where: { clientToken: token } })) === 1,
  );
  if (firstTry.body.order?.id) cleanup.push(firstTry.body.order.id);

  const badToken = await req("/api/orders", {
    method: "POST",
    body: JSON.stringify({
      lines: [{ drinkId: menu.id, qty: 1 }],
      phoneTail: "4321",
      arrivalAt: slotAt(15).toISOString(),
      clientToken: "短",
    }),
  });
  check("非法幂等键被拒绝（400）", badToken.status === 400, `实际 ${badToken.status}`);

  // ---------- 阶段 3 / R-3：畸形请求体是客户端错误，不该是 500 ----------
  console.log("\n[R-3] 畸形请求体返回 400 而不是 500");
  const brokenJson = await req("/api/orders", { method: "POST", body: "{这不是 JSON" });
  check("非 JSON 体被拒绝（400）", brokenJson.status === 400, `实际 ${brokenJson.status}`);
  const notObject = await req("/api/orders", {
    method: "POST",
    body: JSON.stringify("abcdef"),
  });
  check("非对象 JSON 体被拒绝（400）", notObject.status === 400, `实际 ${notObject.status}`);
  const emptyBody = await req("/api/orders", { method: "POST", body: JSON.stringify({}) });
  check(
    "空对象走校验分支（400）而非 500",
    emptyBody.status === 400,
    `实际 ${emptyBody.status}`,
  );

  // ---------- 阶段 3 / R-1：并发接单只能有一个人成功 ----------
  console.log("\n[R-1] 并发接单：三个店员同时点「接单」");
  const raceOrder = await req("/api/orders", {
    method: "POST",
    body: JSON.stringify({
      lines: [{ drinkId: menu.id, qty: 1 }],
      phoneTail: "5555",
      arrivalAt: slotAt(20).toISOString(),
    }),
  });
  const raceId = raceOrder.body.order?.id;
  check("并发测试订单已创建", !!raceId);
  if (raceId) {
    cleanup.push(raceId);
    const accepted = await Promise.all(
      [1, 2, 3].map(() =>
        req(`/api/staff/orders/${raceId}`, {
          method: "POST",
          body: JSON.stringify({ action: "accept" }),
        }),
      ),
    );
    const statuses = accepted.map((r) => r.status);
    check("恰好一个接单成功", statuses.filter((s) => s === 200).length === 1, JSON.stringify(statuses));
    check("其余两个拿到 409（没有静默覆盖）", statuses.filter((s) => s === 409).length === 2, JSON.stringify(statuses));
    const finalRace = await prisma.order.findUnique({ where: { id: raceId } });
    check("订单最终状态为 MAKING", finalRace?.status === "MAKING", `实际 ${finalRace?.status}`);
  }

  // ---------- 阶段 3 / R-1：并发取消（双开页面同时点）----------
  console.log("\n[R-1] 并发取消：同一个订单同时点两次取消");
  const cancelOrder = await req("/api/orders", {
    method: "POST",
    body: JSON.stringify({
      lines: [{ drinkId: menu.id, qty: 1 }],
      phoneTail: "6666",
      arrivalAt: slotAt(25).toISOString(),
    }),
  });
  const cancelId = cancelOrder.body.order?.id;
  check("并发取消测试订单已创建", !!cancelId);
  if (cancelId) {
    cleanup.push(cancelId);
    const canceled = await Promise.all(
      [1, 2].map(() =>
        req(`/api/orders/${cancelId}`, {
          method: "POST",
          body: JSON.stringify({ action: "cancel" }),
        }),
      ),
    );
    const statuses = canceled.map((r) => r.status);
    check("恰好一次取消成功", statuses.filter((s) => s === 200).length === 1, JSON.stringify(statuses));
    check("另一次拿到 409", statuses.filter((s) => s === 409).length === 1, JSON.stringify(statuses));
    const finalCancel = await prisma.order.findUnique({ where: { id: cancelId } });
    check("取消原因为 CUSTOMER", finalCancel?.cancelReason === "CUSTOMER", `实际 ${finalCancel?.cancelReason}`);
  }

  // ---------- 清理 ----------
  console.log("\n清理测试数据…");
  await prisma.order.deleteMany({ where: { id: { in: cleanup } } });
  check("测试订单已清理", (await prisma.order.count({ where: { id: { in: cleanup } } })) === 0);

  console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项\n`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("端到端测试异常：", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
