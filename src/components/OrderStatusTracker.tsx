"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readableError } from "@/lib/error-text";

type OrderItem = {
  id: string;
  nameSnap: string;
  sizeSnap: string;
  qty: number;
  priceCents: number;
};

type Order = {
  id: string;
  status: string;
  phoneTail: string;
  arrivalAt: string;
  startMakingAt: string | null;
  totalCents: number;
  note: string | null;
  cancelReason: string | null;
  holdRequestedAt: string | null;
  items: OrderItem[];
};

type Payload = {
  order: Order;
  expectedReadyAt: string;
  freeCancelDeadline: string | null;
  autoCancelDeadline: string | null;
  serverNow: string;
};

const STATUS_TEXT: Record<string, string> = {
  UNPAID: "待支付",
  PENDING: "已下单，等店家接单",
  MAKING: "店家正在做您的咖啡",
  READY: "已做好，到店报手机尾号取餐",
  PICKED_UP: "已完成，谢谢惠顾",
  CANCELED: "订单已取消",
};

const CANCEL_TEXT: Record<string, string> = {
  TIMEOUT: "超过 3 分钟店家未接单，已自动取消并退款",
  REJECT_SOLD_OUT: "店家回复：相关饮品已售罄，已全额退款",
  REJECT_BUSY: "店家回复：这会儿实在忙不过来，已全额退款",
  CUSTOMER: "您已取消本单，款项将原路退回",
};

function fmtTime(iso: string | null): string {
  if (!iso) return "--:--";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function yuan(cents: number): string {
  return `¥${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
}

function countdownText(deadlineIso: string | null, now: number): string | null {
  if (!deadlineIso) return null;
  const ms = new Date(deadlineIso).getTime() - now;
  if (ms <= 0) return null;
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;
}

/** AC-11：状态变更需在 30 秒内可见，这里用 4 秒轮询保证体验 */
const POLL_MS = 4000;
/** 拉取失败后的重试间隔（阶段 3 / R-6）：比正常轮询更急一点，恢复得更快 */
const RETRY_MS = 3000;

function fmtClock(ms: number): string {
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

export default function OrderStatusTracker({ initial }: { initial: Payload }) {
  const [data, setData] = useState<Payload>(initial);
  const [now, setNow] = useState(() => Date.now());
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 断网可见性（R-6）：拿不到最新数据时必须说出来，不能让人对着旧状态做决定
  const [offline, setOffline] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const status = data.order.status;
  const isFinal = status === "PICKED_UP" || status === "CANCELED";

  /** 返回本次是否成功，供轮询决定下一次的间隔（R-6） */
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/orders/${initial.order.id}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setOffline(false);
      setLastSyncAt(Date.now());
      return true;
    } catch {
      // 不抛出：轮询失败是常态（地铁里、电梯里），抛出去只会变成控制台噪声
      setOffline(true);
      return false;
    }
  }, [initial.order.id]);

  // 轮询：终态后停止；成功后 4 秒一次，失败后 3 秒重试（R-6）
  useEffect(() => {
    if (isFinal) return;
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
      if (next) clearTimeout(next);
    };
  }, [isFinal, refresh]);

  // 本地秒级刷新倒计时，不依赖服务端
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!toast) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 3200);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [toast]);

  async function act(action: "cancel" | "hold") {
    setBusy(true);
    try {
      const res = await fetch(`/api/orders/${initial.order.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "操作失败");
      await refresh();
      setToast(action === "cancel" ? "已取消，退款将原路退回" : "已通知店员");
    } catch (err) {
      // 网络层失败说明此刻也拿不到最新状态，顺手把横幅亮起来（R-7）
      if (err instanceof TypeError) setOffline(true);
      setToast(readableError(err));
    } finally {
      setBusy(false);
    }
  }

  const freeLeft = countdownText(data.freeCancelDeadline, now);
  const autoLeft = countdownText(data.autoCancelDeadline, now);
  const badgeClass =
    status === "CANCELED"
      ? "badge badge-danger"
      : status === "READY" || status === "PICKED_UP"
        ? "badge"
        : "badge badge-warn";

  return (
    <>
      {offline && (
        <div className="card card-tight" role="status" aria-live="polite">
          <span className="badge badge-warn">网络不稳</span>
          <div className="muted">
            正在重试…下面显示的状态可能不是最新的，恢复后会自动更新。
          </div>
        </div>
      )}

      <div className="card">
        <span className={badgeClass}>{STATUS_TEXT[status] ?? status}</span>

        {status === "CANCELED" ? (
          <>
            <h2 style={{ fontSize: 20, margin: "12px 0 4px" }}>
              {CANCEL_TEXT[data.order.cancelReason ?? ""] ?? "订单已取消"}
            </h2>
            <p className="muted">
              未取餐无需到店，如需重新下单请返回首页。
            </p>
          </>
        ) : (
          <>
            <div className="muted" style={{ marginTop: 12 }}>
              {status === "READY" || status === "PICKED_UP"
                ? "取餐时间"
                : "预计做好 / 到店即可取"}
            </div>
            <div className="big-time mono">
              {fmtTime(data.expectedReadyAt)}
            </div>
            {status === "PENDING" && (
              <p className="muted">
                已通知店家，接单后会立即开始按时间倒推制作
                {autoLeft ? `（${autoLeft} 内未接单将自动取消并退款）` : ""}
              </p>
            )}
            {status === "MAKING" && (
              <p className="muted">
                店家已接单，将在 {fmtTime(data.order.startMakingAt)} 开始制作
              </p>
            )}
            {status === "READY" && (
              <p className="muted">
                到店报手机尾号 <b className="mono">{data.order.phoneTail}</b> 即可取走
              </p>
            )}
          </>
        )}
      </div>

      {data.order.holdRequestedAt && !isFinal && (
        <div className="card card-tight">
          <span className="hold-flag">已通知店员：我快到了</span>
          <div className="muted">店员侧已收到提示，会优先留意您的订单。</div>
        </div>
      )}

      <div className="card">
        <p className="section-title">订单内容</p>
        {data.order.items.map((it) => (
          <div className="menu-row" key={it.id}>
            <div>
              <div className="menu-name">{it.nameSnap}</div>
              <div className="muted">
                {it.sizeSnap} × {it.qty}
              </div>
            </div>
            <span className="price">{yuan(it.priceCents * it.qty)}</span>
          </div>
        ))}
        {data.order.note && (
          <p className="muted" style={{ marginTop: 10 }}>
            备注：{data.order.note}
          </p>
        )}
        <div className="divider" />
        <div className="switch-row">
          <span className="muted">合计</span>
          <span className="price" style={{ fontSize: 18 }}>
            {yuan(data.order.totalCents)}
          </span>
        </div>
        <div className="switch-row" style={{ marginTop: 6 }}>
          <span className="muted">取餐凭据</span>
          <span className="mono">手机尾号 {data.order.phoneTail}</span>
        </div>
      </div>

      {!isFinal && (
        <div className="card">
          <div className="btn-row">
            <button
              type="button"
              className="btn"
              disabled={busy || status === "READY"}
              onClick={() => act("hold")}
            >
              {status === "READY" ? "已在店取餐" : "我快到了，请帮我留一下"}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy || !freeLeft}
              onClick={() => act("cancel")}
            >
              {freeLeft ? `取消订单（剩 ${freeLeft}）` : "超出免费取消时限"}
            </button>
          </div>
          {!freeLeft && status !== "READY" && (
            <p className="hint">
              已超过 2 分钟免费取消时限。若需取消，请直接联系店员。
            </p>
          )}
        </div>
      )}

      <p className="muted" style={{ textAlign: "center" }}>
        {offline
          ? "网络恢复后会自动同步最新状态"
          : lastSyncAt
            ? `已同步 · 最后更新 ${fmtClock(lastSyncAt)}`
            : "状态每 4 秒自动刷新"}
      </p>

      <p className="muted" style={{ textAlign: "center" }}>
        本单为模拟支付，未产生真实扣款。
      </p>

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
