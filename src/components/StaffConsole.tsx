"use client";

import { useEffect, useRef, useState } from "react";
import { readableError } from "@/lib/error-text";
import { formatClock } from "@/lib/time";
import { usePolling } from "@/lib/use-polling";

type OrderItem = {
  id: string;
  nameSnap: string;
  sizeSnap: string;
  qty: number;
};

type Order = {
  id: string;
  status: string;
  phoneTail: string;
  customerName: string | null;
  arrivalAt: string;
  startMakingAt: string | null;
  note: string | null;
  holdRequestedAt: string | null;
  createdAt: string;
  items: OrderItem[];
};

type Queue = {
  shop: {
    id: string;
    name: string;
    accepting: boolean;
    prepMinutes: number;
  };
  pending: Order[];
  making: Order[];
  ready: Order[];
  stats: {
    todayTotal: number;
    todayPending: number;
    todayMaking: number;
    todayReady: number;
    todayPickedUp: number;
    todayCanceled: number;
  };
};

function fmtTime(iso: string | null): string {
  if (!iso) return "--:--";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function itemsText(items: OrderItem[]): string {
  return items.map((i) => `${i.nameSnap}(${i.sizeSnap}) ×${i.qty}`).join("、");
}

/** 队列按到店时刻排序——这是本产品区别于普通点单小程序的核心机制 */
export default function StaffConsole({ initial }: { initial: Queue }) {
  const [q, setQ] = useState<Queue>(initial);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 队列陈旧可见（R-10）：拉不到数据时必须说出来——店员对着过期队列接单会做错单
  const { offline, lastSyncAt, refresh, markOffline } = usePolling(async () => {
    const res = await fetch("/api/staff/queue", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setQ((await res.json()) as Queue);
  });

  useEffect(() => {
    if (!toast) return;
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [toast]);

  async function orderAct(id: string, action: string, reason?: string) {
    setBusy(true);
    setRejectFor(null);
    try {
      const res = await fetch(`/api/staff/orders/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        // 别人先处理了这一单（双店员同时点、顾客刚取消）——先刷新，别让人继续点
        await refresh();
        throw new Error("这一单刚被其他人处理过，队列已刷新");
      }
      if (!res.ok) throw new Error(body.error ?? "操作失败");
      await refresh();
      const text: Record<string, string> = {
        accept: "已接单，请按队列顺序制作",
        reject: "已拒单并退款",
        ready: "已标记做好",
        pickup: "已标记取餐",
      };
      setToast(text[action] ?? "已完成");
    } catch (err) {
      if (err instanceof TypeError) markOffline();
      setToast(readableError(err, "操作失败，请重试"));
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function shopAct(payload: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch("/api/staff/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "设置失败");
      await refresh();
      setToast(
        "accepting" in payload
          ? body.shop.accepting
            ? "已恢复接单"
            : "已暂停接单"
          : `制作时长已设为 ${body.shop.prepMinutes} 分钟`,
      );
    } catch (err) {
      if (err instanceof TypeError) markOffline();
      setToast(readableError(err, "设置失败，请重试"));
    } finally {
      setBusy(false);
    }
  }

  const now = Date.now();

  function renderPending(o: Order) {
    const late = new Date(o.arrivalAt).getTime() < now;
    return (
      <div className={`queue-item${late ? " is-urgent" : ""}`} key={o.id}>
        <div className="queue-head">
          <span className="queue-time mono">{fmtTime(o.arrivalAt)}</span>
          <span className="muted">到店</span>
        </div>
        <div className="items-line">{itemsText(o.items)}</div>
        <div className="muted" style={{ marginBottom: 8 }}>
          尾号 {o.phoneTail}
          {o.customerName ? ` · ${o.customerName}` : ""} · 下单于{" "}
          {fmtTime(o.createdAt)}
          {late ? " · 已到时间，请尽快处理" : ""}
        </div>
        {o.note && (
          <div className="muted" style={{ marginBottom: 8 }}>
            备注：{o.note}
          </div>
        )}
        {o.holdRequestedAt && (
          <div className="hold-flag">顾客说：我快到了，请帮我留一下</div>
        )}
        {rejectFor === o.id ? (
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-sm btn-danger"
              disabled={busy}
              onClick={() => orderAct(o.id, "reject", "REJECT_SOLD_OUT")}
            >
              售罄
            </button>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              disabled={busy}
              onClick={() => orderAct(o.id, "reject", "REJECT_BUSY")}
            >
              忙不过来
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setRejectFor(null)}
            >
              取消
            </button>
          </div>
        ) : (
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy}
              onClick={() => orderAct(o.id, "accept")}
            >
              接单
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy}
              onClick={() => setRejectFor(o.id)}
            >
              拒单
            </button>
          </div>
        )}
      </div>
    );
  }

  function renderMaking(o: Order) {
    return (
      <div className="queue-item" key={o.id}>
        <div className="queue-head">
          <span className="queue-time mono">{fmtTime(o.arrivalAt)}</span>
          <span className="muted">
            下料 {fmtTime(o.startMakingAt)} · 到店
          </span>
        </div>
        <div className="items-line">{itemsText(o.items)}</div>
        <div className="muted" style={{ marginBottom: 8 }}>
          尾号 {o.phoneTail}
          {o.note ? ` · 备注：${o.note}` : ""}
        </div>
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy}
            onClick={() => orderAct(o.id, "ready")}
          >
            已做好
          </button>
        </div>
      </div>
    );
  }

  function renderReady(o: Order) {
    return (
      <div className="queue-item" key={o.id}>
        <div className="queue-head">
          <span className="queue-time mono">{fmtTime(o.arrivalAt)}</span>
          <span className="muted">等取餐</span>
        </div>
        <div className="items-line">{itemsText(o.items)}</div>
        <div className="muted" style={{ marginBottom: 8 }}>
          尾号 {o.phoneTail}
          {o.holdRequestedAt ? " · 顾客已在路上" : ""}
        </div>
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy}
            onClick={() => orderAct(o.id, "pickup")}
          >
            已取餐
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {offline && (
        <div className="card card-tight" role="status" aria-live="polite">
          <span className="badge badge-warn">队列可能已过期</span>
          <div className="muted">
            网络不稳，正在重试…看到的数据可能不是最新的，恢复后会自动刷新。
          </div>
        </div>
      )}

      <div className="card">
        <div className="switch-row">
          <div>
            <div style={{ fontWeight: 600 }}>
              {q.shop.accepting ? "正在接单" : "已暂停接单"}
            </div>
            <div className="muted">
              暂停后顾客侧无法下单，用于高峰期控速
            </div>
          </div>
          <button
            type="button"
            className="switch"
            aria-pressed={q.shop.accepting}
            aria-label="暂停或恢复接单"
            disabled={busy}
            onClick={() => shopAct({ accepting: !q.shop.accepting })}
          />
        </div>
        <div className="divider" />
        <div className="switch-row">
          <div>
            <div style={{ fontWeight: 600 }}>制作时长</div>
            <div className="muted">
              决定下料时刻 = 到店时刻 − 此值（当前 {q.shop.prepMinutes} 分钟）
            </div>
          </div>
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy || q.shop.prepMinutes <= 1}
              onClick={() => shopAct({ prepMinutes: q.shop.prepMinutes - 1 })}
            >
              −
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy || q.shop.prepMinutes >= 30}
              onClick={() => shopAct({ prepMinutes: q.shop.prepMinutes + 1 })}
            >
              +
            </button>
          </div>
        </div>
      </div>

      <div className="card card-tight">
        <div className="stats">
          <div className="stat">
            <b>{q.stats.todayTotal}</b>
            <span>今日总单</span>
          </div>
          <div className="stat">
            <b>{q.stats.todayPending}</b>
            <span>待接单</span>
          </div>
          <div className="stat">
            <b>{q.stats.todayMaking}</b>
            <span>制作中</span>
          </div>
          <div className="stat">
            <b>{q.stats.todayReady}</b>
            <span>待取餐</span>
          </div>
          <div className="stat">
            <b>{q.stats.todayPickedUp}</b>
            <span>已取餐</span>
          </div>
          <div className="stat">
            <b>{q.stats.todayCanceled}</b>
            <span>已取消</span>
          </div>
        </div>
      </div>

      <div className="card">
        <p className="section-title">待接单（{q.pending.length}）· 按到店时刻排序</p>
        {q.pending.length === 0 ? (
          <div className="empty">当前没有待接单</div>
        ) : (
          q.pending.map(renderPending)
        )}
      </div>

      <div className="card">
        <p className="section-title">制作中（{q.making.length}）</p>
        {q.making.length === 0 ? (
          <div className="empty">当前没有制作中的订单</div>
        ) : (
          q.making.map(renderMaking)
        )}
      </div>

      <div className="card">
        <p className="section-title">待取餐（{q.ready.length}）</p>
        {q.ready.length === 0 ? (
          <div className="empty">当前没有等待取餐的订单</div>
        ) : (
          q.ready.map(renderReady)
        )}
      </div>

      <p className="muted" style={{ textAlign: "center" }}>
        队列每 4 秒自动刷新；过期未接单的订单会被系统自动取消并退款。
      </p>
      <p className="muted" style={{ textAlign: "center" }}>
        {offline
          ? "网络恢复后队列会自动刷新"
          : lastSyncAt
            ? `已同步 · 最后更新 ${formatClock(lastSyncAt)}`
            : "正在同步…"}
      </p>

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
