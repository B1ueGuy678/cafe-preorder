/**
 * 把异常翻译成顾客看得懂的中文（阶段 3 / R-7）。
 *
 * 为什么需要：fetch 在网络层失败时抛的是 TypeError("Failed to fetch")，
 * 直接展示给顾客就是一句英文报错——比不报错更让人慌。
 */
export function readableError(
  err: unknown,
  fallback = "操作失败，请重试",
): string {
  const raw = err instanceof Error ? err.message : "";
  if (
    err instanceof TypeError ||
    /failed to fetch|networkerror|load failed|fetch failed|network request failed/i.test(raw)
  ) {
    return "网络连接不上，请检查网络后重试（操作可能没有生效）";
  }
  const trimmed = raw.trim();
  // 服务端返回的中文原样透传；空消息或纯 ASCII 消息一律换成兜底文案
  if (!trimmed || /^[\x00-\x7F]+$/.test(trimmed)) return fallback;
  return trimmed;
}
