import { DomainError } from "./domain";

/**
 * 读 JSON 请求体并确认它是对象。
 *
 * 为什么单独抽出来：Next.js 里 `await req.json()` 遇到畸形 body 会抛异常，
 * 落到各路由的 catch 里就变成 500「服务器开小差了」——但请求错在客户端，
 * 应该是 400。这个差异会让「断网重试」的排查彻底走偏（阶段 3 / R-3）。
 */
export async function readJsonObject(
  req: Request,
): Promise<Record<string, unknown>> {
  const raw = await req.text();
  if (raw.trim() === "") return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DomainError("请求格式不正确（需要 JSON）");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new DomainError("请求格式不正确（需要 JSON 对象）");
  }
  return parsed as Record<string, unknown>;
}

/** 限速用的客户端标识：优先取代理头，其次回落到单一 "local"（单店场景够用） */
export function clientKeyOf(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  const ip = fwd?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "local";
  return ip.trim() || "local";
}
