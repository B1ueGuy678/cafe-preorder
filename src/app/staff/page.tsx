import Link from "next/link";
import StaffConsole from "@/components/StaffConsole";
import StaffGate from "@/components/StaffGate";
import { autoCancelStale, getQueue } from "@/lib/domain";
import { isStaffAuthed } from "@/lib/staff-auth";

export const dynamic = "force-dynamic";

export default async function StaffPage() {
  const authed = await isStaffAuthed();

  // 未登录时不读队列：避免把顾客手机尾号渲染进未授权页面的 HTML
  if (!authed) {
    return (
      <>
        <header className="topbar">
          <h1>接单台</h1>
          <Link href="/" className="muted" style={{ textDecoration: "underline" }}>
            顾客端
          </Link>
        </header>
        <main className="shell">
          <StaffGate initial={emptyQueue()} />
        </main>
      </>
    );
  }

  // 进店员台先清一次超时订单（AC-8），保证看到的队列是干净的
  await autoCancelStale();
  const queue = await getQueue();

  const initial = {
    shop: queue.shop,
    pending: queue.pending.map(serialize),
    making: queue.making.map(serialize),
    ready: queue.ready.map(serialize),
    stats: queue.stats,
  };

  return (
    <>
      <header className="topbar">
        <h1>接单台 · {queue.shop.name}</h1>
        <Link href="/" className="muted" style={{ textDecoration: "underline" }}>
          顾客端
        </Link>
      </header>
      <main className="shell shell-wide">
        <StaffConsole initial={initial} />
      </main>
    </>
  );
}

type OrderWithItems = Awaited<ReturnType<typeof getQueue>>["pending"][number];

function emptyQueue() {
  return {
    shop: { id: "", name: "", accepting: true, prepMinutes: 3 },
    pending: [],
    making: [],
    ready: [],
    stats: {
      todayTotal: 0,
      todayPending: 0,
      todayMaking: 0,
      todayReady: 0,
      todayPickedUp: 0,
      todayCanceled: 0,
    },
  };
}

function serialize(o: OrderWithItems) {
  return {
    id: o.id,
    status: o.status as string,
    phoneTail: o.phoneTail,
    customerName: o.customerName,
    arrivalAt: o.arrivalAt.toISOString(),
    startMakingAt: o.startMakingAt?.toISOString() ?? null,
    note: o.note,
    holdRequestedAt: o.holdRequestedAt?.toISOString() ?? null,
    createdAt: o.createdAt.toISOString(),
    items: o.items.map((it) => ({
      id: it.id,
      nameSnap: it.nameSnap,
      sizeSnap: it.sizeSnap,
      qty: it.qty,
    })),
  };
}
