"use client";

import { useState } from "react";
import { readableError } from "@/lib/error-text";
import StaffConsole from "./StaffConsole";

/**
 * 店员端口令门。
 * 未配置 STAFF_PASSCODE 时（开发环境）服务端会直接判定已登录，本组件不会被渲染。
 */
export default function StaffGate({ initial }: { initial: Parameters<typeof StaffConsole>[0]["initial"] }) {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [authed, setAuthed] = useState(false);

  if (authed) return <StaffConsole initial={initial} />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/staff/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "登录失败");
      window.location.reload();
    } catch (err) {
      setError(readableError(err, "登录失败，请重试"));
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <p className="section-title">店员登录</p>
      <p className="muted">
        接单台会显示顾客手机尾号，并可直接操作订单，因此需要口令。
      </p>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="passcode">店员口令</label>
          <input
            id="passcode"
            type="password"
            autoComplete="current-password"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            placeholder="请输入店员口令"
          />
        </div>
        <button
          type="submit"
          className="btn btn-primary"
          style={{ marginTop: 12 }}
          disabled={busy || passcode.length === 0}
          aria-busy={busy}
        >
          {busy ? "校验中…" : "进入接单台"}
        </button>
        {error && (
          <p className="hint" role="alert">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
