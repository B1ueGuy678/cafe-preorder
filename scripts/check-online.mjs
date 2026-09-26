// 上线后只读体检 · 运行：node scripts/check-online.mjs https://your-app.vercel.app
//
// 这一份只发 GET，不写任何数据（不会往真实库里塞测试单），
// 覆盖 docs/DEPLOY.md §5 里能机器核对的部分；人工项在末尾列出。
//
// 用法：
//   node scripts/check-online.mjs https://cafe-preorder.vercel.app
//   node scripts/check-online.mjs http://127.0.0.1:3000        # 本地也能跑，自测用

const BASE = (process.argv[2] ?? "").replace(/\/+$/, "");

if (!/^https?:\/\//.test(BASE)) {
  console.error("用法：node scripts/check-online.mjs <站点根地址>");
  console.error("例如：node scripts/check-online.mjs https://cafe-preorder.vercel.app");
  process.exit(1);
}

let pass = 0;
let fail = 0;

function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log("  ✓ " + name + (detail ? "（" + detail + "）" : ""));
  } else {
    fail++;
    console.log("  ✗ " + name + (detail ? " —— " + detail : ""));
  }
}

async function get(path) {
  const started = Date.now();
  try {
    const res = await fetch(BASE + path, {
      redirect: "manual",
      headers: { "user-agent": "cafe-preorder-check" },
    });
    const text = await res.text();
    return { status: res.status, text, ms: Date.now() - started };
  } catch (err) {
    return { status: 0, text: "", ms: Date.now() - started, error: String(err.message).slice(0, 80) };
  }
}

async function main() {
  console.log("\n在线体检 · " + BASE + "\n");

  // ---------- 顾客端首屏 ----------
  console.log("[顾客端] GET /");
  const home = await get("/");
  check("返回 200", home.status === 200, "实际 " + home.status + "，" + home.ms + "ms" + (home.error ? "，" + home.error : ""));
  check("页面含「到店时间」区块（说明菜单与选项都渲染了）", home.text.includes("到店时间"));
  check("页面含下单按钮文案", home.text.includes("确认并支付") || home.text.includes("请先选择饮品") || home.text.includes("暂无可下单"));

  // ---------- 店员端门禁（重要：不能泄漏手机尾号）----------
  console.log("\n[门禁] GET /staff（未登录）");
  const staff = await get("/staff");
  check("返回 200", staff.status === 200, "实际 " + staff.status);
  const gated = staff.text.includes("店员登录") || staff.text.includes("口令");
  const leakTail = /尾号\s*\d{3,4}/.test(staff.text);
  const leakJson = staff.text.includes('"phoneTail"');
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE);
  if (gated) {
    check("未登录时展示口令门", true);
    check("未登录时不泄漏任何手机尾号", !leakTail && !leakJson);
  } else if (isLocal) {
    console.log("  ! 本地环境未配 STAFF_PASSCODE，按设计直接放行（线上必须配，否则谁都看得到顾客手机尾号）");
    check("未登录时不泄漏任何手机尾号", !leakTail && !leakJson, "队列为空时这一项判定力有限");
  } else {
    check("未登录时展示口令门", false, "线上没配 STAFF_PASSCODE —— 接单台对所有人开放，且暴露顾客手机尾号");
  }

  // ---------- 后端接口 ----------
  console.log("\n[后端] GET /api/orders");
  const api = await get("/api/orders");
  check("返回 200", api.status === 200, "实际 " + api.status + "，" + api.ms + "ms");
  check("返回到店时刻选项（slots）", api.text.includes('"slots"'));
  check("返回接单状态（accepting）", api.text.includes('"accepting"'));
  let accepting = null;
  try { accepting = JSON.parse(api.text).accepting; } catch { /* 解析失败前面已经报错 */ }
  if (accepting === false) console.log("  ! 店铺当前处于「暂停接单」状态（顾客侧会看到暂停提示）");

  // ---------- 定时兜底端点必须关门 ----------
  console.log("\n[安全] GET /api/cron/auto-cancel（不带鉴权）");
  const cron = await get("/api/cron/auto-cancel");
  check(
    "未授权访问被拒绝（401，或未配置 CRON_SECRET 时的 503）",
    cron.status === 401 || cron.status === 503,
    "实际 " + cron.status + (cron.status === 503 ? "：未配置 CRON_SECRET，端点已禁用" : ""),
  );
  check("不是 200（写端点没敞着）", cron.status !== 200);

  // ---------- 不存在的订单应 404 ----------
  console.log("\n[404] GET /order/this-order-does-not-exist");
  const missing = await get("/order/this-order-does-not-exist");
  check("返回 404", missing.status === 404, "实际 " + missing.status);

  console.log("\n结果：通过 " + pass + " 项，失败 " + fail + " 项");
  console.log("\n仍需人工确认（机器替代不了）：");
  console.log("  · 真机/模拟器 375px 无横向滚动（R-14）");
  console.log("  · 断网横幅与失败文案（R-6 / R-7，DevTools → Offline）");
  console.log("  · 完整下单 → 店员接单 → 双端可见（AC-1 / AC-5 / AC-11）");
  console.log("  · 店员端用真实口令登录一次");

  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("体检异常：", err);
  process.exitCode = 1;
});
