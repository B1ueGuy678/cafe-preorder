// 初始化生产数据库（只需一次）
//
// 用法（PowerShell，连接串只在这一条命令里出现，不要写进 .env）：
//   $env:DATABASE_URL="postgresql://user:pw@ep-xxx.aws.neon.tech/neondb?sslmode=require"
//   node scripts/db-init-prod.mjs
//   Remove-Item Env:DATABASE_URL        # 用完清掉，避免影响本地开发
//
// 它做了什么：
//   1. 从环境变量里挑出**直连**连接串（DDL 不能用池化地址，见下），并校验它是 Postgres
//   2. 临时把 provider 切成 postgresql 并生成 Postgres 版 Prisma Client
//   3. prisma db push 建表 + prisma/seed.mjs 写种子数据（幂等，可重复跑）
//   4. **无论成败**都把 provider 切回 sqlite 并重新生成 Client，保证本地开发不受影响
//
// 连接串优先级（Vercel 的 Postgres 集成会给好几个名字，这里自动挑）：
//   DATABASE_URL_UNPOOLED → POSTGRES_URL_NON_POOLING → DATABASE_URL
//   → POSTGRES_PRISMA_URL → POSTGRES_URL
// 为什么优先直连：Neon 的池化地址（主机名带 -pooler）不支持建表这类语句，
// db push 会失败；而应用运行时反而应该用池化地址（见 src/lib/db-url.ts）。

import { spawnSync } from "node:child_process";

const ROOT = process.cwd();

const CANDIDATES = [
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_URL_NON_POOLING",
  "DATABASE_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL",
];

function mask(u) {
  // 打印目标但隐藏密码：只留 协议://用户名@主机/库名
  return u.replace(/^([a-z]+):\/\/([^:]+):[^@]*@/i, "$1://$2@");
}

const picked = CANDIDATES.map((key) => [key, (process.env[key] ?? "").trim()]).find(
  ([, value]) => value.length > 0,
);

if (!picked) {
  console.error("× 没找到任何 Postgres 连接串环境变量，已中止。");
  console.error("  期望以下之一：" + CANDIDATES.join(" / "));
  console.error('  用法：$env:DATABASE_URL="postgresql://..."; node scripts/db-init-prod.mjs');
  process.exit(1);
}

const [keyName, url] = picked;

if (!/^postgres(ql)?:\/\//i.test(url)) {
  console.error("× " + keyName + " 不是 Postgres 连接串，已中止。");
  console.error("  这个脚本只用来初始化**生产**库；本地 SQLite 用 npm run db:push / db:seed。");
  process.exit(1);
}

console.log("使用变量：" + keyName);
console.log("目标数据库：" + mask(url));

if (/-pooler|pgbouncer=true/i.test(url)) {
  console.log("! 这个连接串看起来是**池化**地址（-pooler / pgbouncer）：建表语句在池化器上可能失败。");
  console.log("  建议改用直连串：集成里通常叫 DATABASE_URL_UNPOOLED 或 POSTGRES_URL_NON_POOLING。");
}

// 子进程统一用「挑出来的那条」当 DATABASE_URL（prisma CLI 与 PrismaClient 都认这个名字）
const childEnv = { ...process.env, DATABASE_URL: url };

function run(label, args) {
  console.log("\n▶ " + label);
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: "inherit", env: childEnv });
  if (r.status !== 0) throw new Error(label + " 失败（退出码 " + r.status + "）");
}

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
  console.error("  排障：确认连接串带 ?sslmode=require、Neon 项目已就绪、本机能访问该主机（见 SETUP.md 网络限制）");
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
