"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** 正常轮询间隔（AC-11：状态变更需在 30 秒内可见） */
export const POLL_MS = 4000;
/** 失败后的重试间隔（阶段 3 / R-6、R-10）：比正常轮询更急一点，网络恢复后更快跟上 */
export const RETRY_MS = 3000;

/**
 * 轮询同步：把「多久拉一次、失败怎么让人看见」收在一处。
 *
 * 顾客订单页（R-6）与店员接单台（R-10）共用它 —— 两端对断网的表现必须是同一套，
 * 否则顾客看到「网络不稳」而店员对着过期队列继续接单，是最糟糕的组合。
 *
 * @param fetcher 拉一次，并自己把数据写进组件状态；抛错即视为这次同步失败
 * @param enabled 关闭后不再轮询（例如订单已到终态）
 */
export function usePolling(
  fetcher: () => Promise<void>,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const [offline, setOffline] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const alive = useRef(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher; // 每次渲染取最新的 fetcher，避免因为它变化而重启动轮询

  const refresh = useCallback(async () => {
    try {
      await fetcherRef.current();
      if (alive.current) {
        setOffline(false);
        setLastSyncAt(Date.now());
      }
      return true;
    } catch {
      // 不抛出：轮询失败是常态（地铁、电梯、切后台），抛出去只会变成控制台噪声
      if (alive.current) setOffline(true);
      return false;
    }
  }, []);

  /** 写操作因网络失败时也把横幅亮起来——此刻同样拿不到最新状态 */
  const markOffline = useCallback(() => setOffline(true), []);

  useEffect(() => {
    alive.current = true;
    if (!enabled) {
      return () => {
        alive.current = false;
      };
    }
    let stopped = false;
    let next: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      const ok = await refresh();
      if (stopped) return;
      next = setTimeout(tick, ok ? POLL_MS : RETRY_MS);
    };
    next = setTimeout(tick, POLL_MS);
    return () => {
      stopped = true;
      alive.current = false;
      if (next) clearTimeout(next);
    };
  }, [enabled, refresh]);

  return { offline, lastSyncAt, refresh, markOffline };
}
