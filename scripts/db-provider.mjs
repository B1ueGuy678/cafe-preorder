// 数据库 provider 切换：本地 SQLite ↔ 生产 Postgres
//
// 为什么需要脚本：Prisma 的 datasource provider 不能读环境变量，
// 而本产品的两个目标互相冲突——
//   * 本地开发要「零安装就能跑」（SQLite）
//   * Vercel / 生产要持久化（无服务器文件系统，必须 Postgres）
// 手工改 schema 再改回来，迟早会漏掉一次；所以用脚本做，且只改 provider 那一行。
//
// 用法：
//   node scripts/db-provider.mjs status     # 看当前用的是哪个
//   node scripts/db-provider.mjs postgres   # 切到 PostgreSQL（部署前）
//   node scripts/db-provider.mjs sqlite     # 切回 SQLite（本地开发）
//
// 切完记得跑：node ./node_modules/prisma/build/index.js generate

import { readFileSync, writeFileSync } from "node:fs";

const SCHEMA = "prisma/schema.prisma";
const LINE = /^(\s*provider\s*=\s*)"(sqlite|postgresql)"(.*)$/m;

const raw = (process.argv[2] ?? "status").toLowerCase();
// 允许 postgres / postgresql 两种写法（Prisma 自己的名字是 postgresql）
const target = raw === "postgres" || raw === "postgresql" ? "postgresql" : raw;
const src = readFileSync(SCHEMA, "utf8");
const match = src.match(LINE);

if (!match) {
  console.error("在 " + SCHEMA + " 里找不到 datasource provider 那一行，脚本已放弃修改。");
  process.exit(1);
}

const current = match[2];
if (target === "status") {
  console.log("当前 provider：" + current);
  process.exit(0);
}
if (target !== "sqlite" && target !== "postgresql") {
  console.error("用法：node scripts/db-provider.mjs status|sqlite|postgresql");
  process.exit(1);
}
if (current === target) {
  console.log("provider 已经是 " + target + "，无需修改。");
  process.exit(0);
}

writeFileSync(SCHEMA, src.replace(LINE, '$1"' + target + '"$3'));
console.log("provider：" + current + " → " + target);
if (target === "postgresql") {
  console.log("下一步：设好 DATABASE_URL（Postgres），再跑 prisma generate + db push + db:seed");
} else {
  console.log("本地开发用 DATABASE_URL=\"file:./dev.db\"，跑 prisma generate + db push + db:seed");
}
