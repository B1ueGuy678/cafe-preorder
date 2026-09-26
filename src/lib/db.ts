import { PrismaClient } from "@prisma/client";
import { resolveDatabaseUrl } from "./db-url";

// Next.js 开发模式下模块会被热重载，用全局单例避免连接数爆炸
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// 变量名兜底（见 db-url.ts）：显式把解析出来的连接串交给 Prisma，
// 免得部署时因为集成注入的是 POSTGRES_URL 而不是 DATABASE_URL 就起不来
const url = resolveDatabaseUrl();

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    ...(url ? { datasources: { db: { url } } } : {}),
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
