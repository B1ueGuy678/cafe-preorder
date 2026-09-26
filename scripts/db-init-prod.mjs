// 初始化生产数据库（只需一次）
//
// 用法（PowerShell，连接串只在这一条命令里出现，不要写进 .env）：
//   $env:DATABASE_URL="postgresql://user:pw@ep-xxx.neon.tech/neondb?sslmode=require"
//   node scripts/db-init-prod.mjs
//   Remove-Item Env:DATABASE_URL        # 用完清掉，避免影响本地开发
//
// 它做了什么：
//   1. 校验 DATABASE_URL 确实是 Postgres 连接串（防止手滑拿本地 SQLite 去初始化生产库）
//   2. 临时把 provider 切成 postgresql 并生成 Postgres 版 Prisma Client
//   3. prisma db push 建表 + prisma/seed.mjs 写种子数据（幂等，可重复跑）
//   4. **无论成败**都把 provider 切回 sqlite 并重新生成 Client，保证本地开发不受影响
//
// 为什么需要临时切换：Prisma 的 datasource provider 不能读环境变量，
// 而本地开发必须用 SQLite（本机对外 HTTPS 受限，云数据库在本地连不上，见 SETUP.md）。
// Vercel 那边由 vercel.json 的 buildCommand 自动做同样的切换，所以仓库里永远是 sqlite。

import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const url = (process.env.DATABASE_URL ?? "").trim();

function mask(u) {
  // 打印目标但隐藏密码：只留 用户名@主机/库名
  return u.replace(/^([a-z]+):\/\/([^:]+):[^@]*@/i, "$1://$2@");
}

function run(label, args) {
  console.log("\n▶ " + label);
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) throw new Error(label + " 失败（退出码 " + r.status + "）");
}

if (!/^postgres(ql)?:\/\//i.test(url)) {
  console.error("× DATABASE_URL 不是 Postgres 连接串，已中止。");
  console.error("  这个脚本只用来初始化**生产**库；本地 SQLite 用 npm run db:push / db:seed。");
  console.error('  正确用法：$env:DATABASE_URL="postgresql://..."; node scripts/db-init-prod.mjs');
  process.exit(1);
}

console.log("目标数据库：" + mask(url));
let failed = false;
try {
  run("1/4 切 provider 到 postgresql", ["./scripts/db-provider.mjs", "postgres"]);
  run("2/4 生成 Postgres 版 Prisma Client", ["./node_modules/prisma/build/index.js", "generate"]);
  run("3/4 建表（prisma db push）", ["./node_modules/prisma/build/index.js", "db", "push", "--skip-generate"]);
  run("4/4 写入种子数据（一家店 + 12 项菜单）", ["./prisma/seed.mjs"]);
  console.log("\n✅ 生产库初始化完成。去线上访问 / 应该能看到「巷口咖啡」与 12 项菜单。");
} catch (err) {
  failed = true;
  console.error("\n× " + err.message);
  console.error("  排障：确认连接串带 ?sslmode=require、Neon 项目已就绪、本机能访问该主机（见 SETUP.md 的网络限制）");
} finally {
  console.log("\n▶ 还原本地开发环境");
  const back = spawnSync(process.execPath, ["./scripts/db-provider.mjs", "sqlite"], { cwd: ROOT, stdio: "inherit" });
  const gen = spawnSync(process.execPath, ["./node_modules/prisma/build/index.js", "generate"], { cwd: ROOT, stdio: "inherit" });
  if (back.status !== 0 || gen.status !== 0) {
    console.error("！还原失败，请手动执行：node scripts/db-provider.mjs sqlite && node ./node_modules/prisma/build/index.js generate");
    failed = true;
  } else {
    console.log("本地开发环境已还原（provider=sqlite + SQLite 版 Client）");
  }
}
if (failed) process.exitCode = 1;
