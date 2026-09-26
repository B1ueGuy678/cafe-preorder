"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readableError } from "@/lib/error-text";

type Drink = {
  id: string;
  name: string;
  size: string;
  priceCents: number;
  sortOrder: number;
};

type Options = {
  slots: string[];
  prepMinutes: number;
  accepting: boolean;
  shopName: string;
  openTime: string;
  closeTime: string;
};

function fmt(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function yuan(cents: number): string {
  return `¥${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
}

/** 常点置顶：sortOrder 靠前的直接展示，其余折叠 */
const TOP_N = 4;

/** 下单幂等键（R-2）：同一次下单意图的重试复用同一个值 */
function newClientToken(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export default function OrderPicker({
  drinks,
  options,
}: {
  drinks: Drink[];
  options: Options;
}) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [arrival, setArrival] = useState<string>("");
  const [phoneTail, setPhoneTail] = useState("");
  const [note, setNote] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 请求已发出但结果未知时（断网/超时）保留它，让重试被服务端认出来
  const pendingToken = useRef<string | null>(null);

  // 默认选中第一个可用时刻：AC-1 要求 30 秒内下单，不能逼用户先想时间
  useEffect(() => {
    if (!arrival && options.slots.length > 0) setArrival(options.slots[0]);
  }, [arrival, options.slots]);

  const top = useMemo(() => drinks.slice(0, TOP_N), [drinks]);
  const rest = useMemo(() => drinks.slice(TOP_N), [drinks]);
  const visible = showAll ? [...top, ...rest] : top;

  const totalCents = useMemo(
    () =>
      drinks.reduce((sum, d) => sum + (qty[d.id] ?? 0) * d.priceCents, 0),
    [drinks, qty],
  );
  const itemCount = useMemo(
    () => Object.values(qty).reduce((a, b) => a + b, 0),
    [qty],
  );

  const change = useCallback((id: string, delta: number) => {
    setQty((prev) => {
      const next = Math.max(0, Math.min(10, (prev[id] ?? 0) + delta));
      return { ...prev, [id]: next };
    });
  }, []);

  // 空态（R-8）：没有饮品、没有可选时刻都不该让人对着空白卡片猜
  const noDrinks = drinks.length === 0;
  const noSlots = options.slots.length === 0;

  const canSubmit =
    !noDrinks &&
    !noSlots &&
    itemCount > 0 &&
    !!arrival &&
    /^\d{4}$/.test(phoneTail) &&
    options.accepting;

  async function submit() {
    // 防重（R-9）：按钮 disabled 之外再挡一道，键盘回车/连点都不会重复提交
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    if (!pendingToken.current) pendingToken.current = newClientToken();
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: Object.entries(qty)
            .filter(([, q]) => q > 0)
            .map(([drinkId, q]) => ({ drinkId, qty: q })),
          phoneTail,
          arrivalAt: arrival,
          note,
          clientToken: pendingToken.current,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // 服务端明确拒绝了 → 结果确定（没有落单）→ 下次点击算新的下单意图
        pendingToken.current = null;
        throw new Error(data.error ?? "下单失败");
      }
      window.location.href = `/order/${data.order.id}`;
    } catch (err) {
      // 网络层失败时 token 故意保留：结果未知，重试必须复用（R-2）
      setError(readableError(err, "下单失败，请重试"));
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="card">
        <p className="section-title">常点（为你置顶）</p>
        {noDrinks && (
          <p className="empty" role="status">
            店家还没有上架饮品，暂时无法在这里下单。可以直接到店点单。
          </p>
        )}
        {visible.map((d) => (
          <div className="menu-row" key={d.id}>
            <div>
              <div className="menu-name">{d.name}</div>
              <div className="muted">
                {d.size} · <span className="price">{yuan(d.priceCents)}</span>
              </div>
            </div>
            <div className="stepper">
              <button
                type="button"
                aria-label={`减少 ${d.name}`}
                onClick={() => change(d.id, -1)}
                disabled={(qty[d.id] ?? 0) === 0}
              >
                −
              </button>
              <span className="qty" aria-live="polite">
                {qty[d.id] ?? 0}
              </span>
              <button
                type="button"
                aria-label={`增加 ${d.name}`}
                onClick={() => change(d.id, 1)}
              >
                +
              </button>
            </div>
          </div>
        ))}
        {rest.length > 0 && (
          <button
            type="button"
            className="btn btn-sm"
            style={{ marginTop: 12, width: "100%" }}
            onClick={() => setShowAll((v) => !v)}
            aria-expanded={showAll}
          >
            {showAll ? "收起" : `其他饮品（${rest.length}）`}
          </button>
        )}
      </div>

      <div className="card">
        <p className="section-title">到店时间（必选）</p>
        {noSlots && (
          <p className="empty" role="status">
            现在没有可选的到店时间（可能已经打烊）。稍后再来，或者直接到店点单。
          </p>
        )}
        <div className="slots" role="group" aria-label="选择到店时间">
          {options.slots.map((iso) => (
            <button
              key={iso}
              type="button"
              className="slot"
              aria-pressed={arrival === iso}
              onClick={() => setArrival(iso)}
            >
              {fmt(iso)}
              <small>到店</small>
            </button>
          ))}
        </div>
        <p className="hint">
          ⓘ 请选择接近您到店的取餐时间。我们会按您到店的时刻倒推开始制作——
          早到了它在做，准点到它刚好。
        </p>
      </div>

      <div className="card">
        <div className="field" style={{ marginTop: 0 }}>
          <label htmlFor="phoneTail">手机号后四位（取餐时报给店员，必填）</label>
          <input
            id="phoneTail"
            inputMode="numeric"
            maxLength={4}
            placeholder="例如 4213"
            value={phoneTail}
            onChange={(e) => setPhoneTail(e.target.value.replace(/\D/g, ""))}
          />
        </div>
        <div className="field">
          <label htmlFor="note">备注（可选，如少冰 / 不加糖）</label>
          <input
            id="note"
            placeholder="例如：少冰、不加糖"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={50}
          />
        </div>
      </div>

      <div className="card">
        <div className="switch-row">
          <div>
            <div className="muted">预计做好</div>
            <div className="big-time mono">
              {arrival ? fmt(arrival) : "--:--"}
            </div>
            <div className="muted">
              我们会在 {options.prepMinutes} 分钟前开始制作
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="muted">合计</div>
            <div className="big-time mono">{yuan(totalCents)}</div>
          </div>
        </div>
        <div className="divider" />
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canSubmit || submitting}
          aria-busy={submitting}
          onClick={submit}
        >
          {submitting
            ? "正在下单…"
            : !options.accepting
              ? "店家暂停接单中"
              : noDrinks
                ? "暂无可下单的饮品"
                : noSlots
                  ? "暂无可选的到店时间"
                  : itemCount > 0
                    ? `确认并支付 ${yuan(totalCents)}`
                    : "请先选择饮品"}
        </button>
        {!options.accepting && (
          <p className="hint">
            店家当前暂停接单（高峰忙不过来时会开启）。可直接到店点单，或稍后重试。
          </p>
        )}
        {error && (
          <p className="hint" role="alert">
            {error}
          </p>
        )}
        <p className="muted" style={{ marginTop: 10, textAlign: "center" }}>
          本页为模拟支付，不会真实扣款
        </p>
      </div>
    </>
  );
}
