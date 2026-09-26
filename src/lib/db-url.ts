/**
 * 解析数据库连接串（阶段 6 接生产库时加的一层兜底）。
 *
 * 为什么需要：Vercel 的 Postgres（Neon）集成会注入好几个变量名，不同版本/不同接入
 * 方式给的组合并不完全一样（`DATABASE_URL` / `POSTGRES_PRISMA_URL` / `POSTGRES_URL`…）。
 * 本项目只认 `DATABASE_URL`，但为了「接上就能跑」，这里按优先级兜底。
 *
 * 另一个必须说清的区别（踩过就懂）：
 *   · **运行时查询**用池化连接串（`-pooler` 主机）—— 无服务器并发下更稳
 *   · **DDL（db push / migrate）必须用直连串** —— 池化器不支持建表那类语句
 * 直连串的挑选在 `scripts/db-init-prod.mjs` 里。
 */
const RUNTIME_KEYS = ["DATABASE_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL"] as const;

export function resolveDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  for (const key of RUNTIME_KEYS) {
    const value = env[key];
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

/** 连接串是不是池化地址：用于给出更好懂的提示，不参与逻辑判断 */
export function isPooledUrl(url: string | undefined): boolean {
  return !!url && /-pooler|pgbouncer=true/i.test(url);
}
