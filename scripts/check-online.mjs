// 上线后只读体检 · 运行：node scripts/check-online.mjs https://your-app.vercel.app
//
// 只发 GET 和**注定失败**的 POST（畸形体 / 非法参数 / 未授权的写），
// 不会往真实库里写任何数据。
//
// 用法：
//   node scripts/check-online.mjs https://cafe-preorder.vercel.app
//   node scripts/check-online.mjs http://127.0.0.1:3000        # 本地也能跑，自测用
//
// 如果这台机器要走代理（本项目开发机就是这样，直连被重置）：
//   $env:NODE_USE_ENV_PROXY=1
//   $env:HTTPS_PROXY="http://127.0.0.1:23995"
//   node scripts/check-online.mjs https://cafe-preorder.vercel.app

const BASE = (process.argv[2] ?? "").replace(/\/+$/, "");

if (!/^https?:\/\//.test(BASE)) {
  console.error("用法：node scripts/check-online.mjs <站点根地址>");
  console.error("例如：node scripts/check-online.mjs https://cafe-preorder.vercel.app");
  process.exit(1);
}

const IS_LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE);

let pass = 0;
let fail = 0;
let networkFailures = 0;

function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log("  ✓ " + name + (detail ? "（" + detail + "）" : ""));
  } else {
    fail++;
    console.log("  ✗ " + name + (detail ? " —— " + detail : ""));
  }
}

function note(text) {
  console.log("  ! " + text);
}

async function call(method, path, body) {
  const started = Date.now();
  try {
    const res = await fetch(BASE + path, {
      method,
      redirect: "manual",
      headers: body ? { "content-type": "application/json" } : {},
      body,
    });
    const text = await res.text();
    return { status: res.status, text, ms: Date.now() - started };
  } catch (err) {
    networkFailures++;
    return { status: 0, text: "", ms: Date.now() - started, error: String(err.message).slice(0, 80) };
  }
}

const get = (path) => call("GET", path);
const post = (path, body) => call("POST", path, body);

async function main() {
  console.log("");
  console.log("在线体检 · " + BASE);
  console.log("");

  // ---------- 顾客端首屏 ----------
  console.log("[顾客端] GET /");
  const home = await get("/");
  check("返回 200", home.status === 200, "实际 " + home.status + "，" + home.ms + "ms" + (home.error ? "，" + home.error : ""));
  check("含「到店时间」区块", home.text.includes("到店时间"));
  check("渲染出至少一个饮品条目（说明数据库连上了且有种子数据）", home.text.includes("menu-name"));
  check("含下单按钮文案", home.text.includes("确认并支付") || home.text.includes("请先选择饮品") || home.text.includes("暂无可下单"));

  // ---------- 店员端门禁 ----------
  console.log("");
  console.log("[门禁] GET /staff（未登录）");
  const staff = await get("/staff");
  check("返回 200", staff.status === 200, "实际 " + staff.status);
  const gated = staff.text.includes("店员登录") || staff.text.includes("口令");
  const leakTail = /尾号\s*\d{3,4}/.test(staff.text);
  const leakJson = staff.text.includes('"phoneTail"');
  if (gated) {
    check("未登录时展示口令门", true);
    check("未登录时不泄漏任何手机尾号", !leakTail && !leakJson);
  } else if (IS_LOCAL) {
    note("本地未配 STAFF_PASSCODE，按设计放行（线上必须配，否则谁都看得到顾客手机尾号）");
    check("未登录时不泄漏任何手机尾号", !leakTail && !leakJson, "队列为空时判定力有限");
  } else {
    check("未登录时展示口令门", false, "线上没配 STAFF_PASSCODE —— 接单台对所有人开放，且暴露顾客手机尾号");
  }

  console.log("");
  console.log("[门禁] 未登录调用店员写接口");
  const write = await post("/api/staff/orders/check-probe-nonexistent", JSON.stringify({ action: "accept" }));
  if (write.status === 401) {
    check("未登录写操作被拒绝（401）", true);
    check("返回 JSON 错误而不是 HTML 页面（确认打到了接口）", write.text.trim().startsWith("{"));
  } else if (IS_LOCAL) {
    note("本地未配 STAFF_PASSCODE，写接口按设计放行（返回 " + write.status + "）；线上必须 401");
  } else {
    check("未登录写操作被拒绝（401）", false, "实际 " + write.status + " —— 接单/拒单接口对未登录者开放是严重问题");
  }

  // ---------- 后端接口 ----------
  console.log("");
  console.log("[后端] GET /api/orders");
  const api = await get("/api/orders");
  check("返回 200", api.status === 200, "实际 " + api.status + "，" + api.ms + "ms");
  check("返回到店时刻选项（slots）", api.text.includes('"slots"'));
  check("返回接单状态（accepting）", api.text.includes('"accepting"'));
  let accepting = null;
  try { accepting = JSON.parse(api.text).accepting; } catch { /* 上面已报错 */ }
  if (accepting === false) note("店铺当前处于「暂停接单」状态（顾客侧会看到暂停提示）");

  // ---------- 阶段 3 的异常路径：线上也应生效 ----------
  console.log("");
  console.log("[韧性] 畸形 / 非法请求必须是 400（不是 500）");
  const broken = await post("/api/orders", "{这不是 JSON");
  check("畸形 JSON 返回 400", broken.status === 400, "实际 " + broken.status);
  const badTail = await post("/api/orders", JSON.stringify({ lines: [{ drinkId: "x", qty: 1 }], phoneTail: "12", arrivalAt: "not-a-date" }));
  check("非法手机尾号返回 400（不会落单）", badTail.status === 400, "实际 " + badTail.status);
  const badToken = await post("/api/orders", JSON.stringify({ lines: [{ drinkId: "x", qty: 1 }], phoneTail: "1234", arrivalAt: "not-a-date", clientToken: "短" }));
  check("非法幂等键返回 400", badToken.status === 400, "实际 " + badToken.status);

  // ---------- 定时兜底端点必须关门 ----------
  console.log("");
  console.log("[安全] GET /api/cron/auto-cancel（不带鉴权）");
  const cron = await get("/api/cron/auto-cancel");
  check("未授权被拒绝（401，或未配 CRON_SECRET 时 503）", cron.status === 401 || cron.status === 503, "实际 " + cron.status + (cron.status === 503 ? "：未配置 CRON_SECRET，端点已禁用" : ""));
  check("不是 200（写端点没敞着）", cron.status !== 200);
  if (cron.status === 503) note("想启用打烊后的定时兜底，在 Vercel 加一个 CRON_SECRET 环境变量即可");

  // ---------- 不存在的订单 ----------
  console.log("");
  console.log("[404] GET /order/this-order-does-not-exist");
  const missing = await get("/order/this-order-does-not-exist");
  check("返回 404", missing.status === 404, "实际 " + missing.status);

  console.log("");
  console.log("结果：通过 " + pass + " 项，失败 " + fail + " 项");
  if (networkFailures > 0) {
    console.log("");
    note("有 " + networkFailures + " 个请求根本没连上。如果这台机器直连被拦，按下面这样走代理再跑一次：");
    console.log('     $env:NODE_USE_ENV_PROXY=1; $env:HTTPS_PROXY="http://127.0.0.1:23995"');
  }
  console.log("");
  console.log("仍需人工确认（机器替代不了）：");
  console.log("  · 真机/模拟器 375px 无横向滚动（R-14）");
  console.log("  · 断网横幅与失败文案（R-6 / R-7，DevTools → Offline）");
  console.log("  · 完整下单 → 店员接单 → 双端可见（AC-1 / AC-5 / AC-11）");
  console.log("  · 店员端用真实口令登录一次");
  console.log("");

  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("体检异常：", err);
  process.exitCode = 1;
});
