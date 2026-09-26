import { notFound } from "next/navigation";
import Link from "next/link";
import OrderStatusTracker from "@/components/OrderStatusTracker";
import {
  DomainError,
  expectedReadyAt,
  getOrder,
} from "@/lib/domain";
import { AUTO_CANCEL_MS, FREE_CANCEL_MS } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function OrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let order;
  try {
    order = await getOrder(id);
  } catch (err) {
    if (err instanceof DomainError && err.status === 404) notFound();
    throw err;
  }

  const isFinal = order.status === "PICKED_UP" || order.status === "CANCELED";
  const payload = {
    order: {
      id: order.id,
      status: order.status,
      phoneTail: order.phoneTail,
      arrivalAt: order.arrivalAt.toISOString(),
      startMakingAt: order.startMakingAt?.toISOString() ?? null,
      totalCents: order.totalCents,
      note: order.note,
      cancelReason: order.cancelReason,
      holdRequestedAt: order.holdRequestedAt?.toISOString() ?? null,
      items: order.items.map((it) => ({
        id: it.id,
        nameSnap: it.nameSnap,
        sizeSnap: it.sizeSnap,
        qty: it.qty,
        priceCents: it.priceCents,
      })),
    },
    expectedReadyAt: expectedReadyAt(order).toISOString(),
    freeCancelDeadline:
      order.paidAt && !isFinal
        ? new Date(order.paidAt.getTime() + FREE_CANCEL_MS).toISOString()
        : null,
    autoCancelDeadline:
      order.status === "PENDING" && order.paidAt
        ? new Date(order.paidAt.getTime() + AUTO_CANCEL_MS).toISOString()
        : null,
    serverNow: new Date().toISOString(),
  };

  return (
    <>
      <header className="topbar">
        <h1>订单详情</h1>
        <Link href="/" className="muted" style={{ textDecoration: "underline" }}>
          再点一单
        </Link>
      </header>
      <main className="shell">
        <OrderStatusTracker initial={payload} />
      </main>
    </>
  );
}
