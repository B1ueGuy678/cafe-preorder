"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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

  const canSubmit =
    itemCount > 0 && !!arrival && /^\d{4}$/.test(phoneTail) && options.accepting;

  async function submit() {
    setError(null);
    setSubmitting(true);
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
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "下单失败");
      window.location.href = `/order/${data.order.id}`;
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="card">
        <p className="section-title">常点（为你置顶）</p>
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
          onClick={submit}
        >
          {submitting
            ? "正在下单…"
            : options.accepting
              ? itemCount > 0
                ? `确认并支付 ${yuan(totalCents)}`
                : "请先选择饮品"
              : "店家暂停接单中"}
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
