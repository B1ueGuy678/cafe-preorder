import { prisma } from "./db";
import {
  AUTO_CANCEL_MS,
  DEFAULT_PREP_MINUTES,
  FREE_CANCEL_MS,
  buildArrivalSlots,
  computeStartMakingAt,
  isOnSlot,
  toMinute,
} from "./time";
import {
  CANCEL_REASON,
  ORDER_STATUS,
  assertTransition,
  type OrderStatus,
} from "./status";

export type CartLine = { drinkId: string; qty: number };

export class DomainError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** 单店场景：取唯一一家店 */
export async function getShop() {
  const shop = await prisma.shop.findFirst({ orderBy: { createdAt: "asc" } });
  if (!shop) throw new DomainError("店铺尚未初始化，请先执行 npm run db:seed", 500);
  return shop;
}

export async function getMenu() {
  const shop = await getShop();
  const drinks = await prisma.drink.findMany({
    where: { shopId: shop.id, available: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return drinks;
}

/** 顾客端可选的到店时刻（5 分钟粒度，AC-2） */
export async function getArrivalOptions(count = 8) {
  const shop = await getShop();
  return {
    slots: buildArrivalSlots(new Date(), count).map((d) => d.toISOString()),
    prepMinutes: shop.prepMinutes,
    accepting: shop.accepting,
    shopName: shop.name,
    openTime: shop.openTime,
    closeTime: shop.closeTime,
  };
}

/**
 * 下单（AC-1 / AC-2 / AC-9）。
 * 阶段 2 为模拟支付：创建订单即视为已支付，直接进入 PENDING。
 */
export async function createOrder(input: {
  lines: unknown;
  phoneTail: unknown;
  arrivalAt: unknown;
  customerName?: unknown;
  note?: unknown;
  /** 幂等键（R-2）：同一次下单意图的重试必须复用同一个值 */
  clientToken?: unknown;
}) {
  const clientToken = parseClientToken(input.clientToken);
  if (clientToken) {
    // 重试：这一次意图已经落过单了，把原来那张还回去，不要再建一张
    const existing = await prisma.order.findUnique({
      where: { clientToken },
      include: { items: true },
    });
    if (existing) return { order: existing, reused: true };
  }

  const shop = await getShop();

  if (!shop.accepting) {
    throw new DomainError("店家当前暂停接单，请稍后再试或直接到店点单", 409);
  }

  const tail = String(input.phoneTail ?? "").trim();
  if (!/^\d{4}$/.test(tail)) {
    throw new DomainError("请填写手机号后四位（取餐时用于核对）");
  }

  if (typeof input.arrivalAt !== "string") {
    throw new DomainError("到店时间格式不正确");
  }
  const arrival = new Date(input.arrivalAt);
  if (Number.isNaN(arrival.getTime())) {
    throw new DomainError("到店时间格式不正确");
  }
  if (arrival.getTime() < Date.now() - 60_000) {
    throw new DomainError("到店时间不能早于当前时间");
  }
  if (!isOnSlot(arrival)) {
    throw new DomainError("到店时间必须是 5 分钟的整数倍");
  }

  const lines = (Array.isArray(input.lines) ? (input.lines as CartLine[]) : [])
    .filter((l) => l && typeof l.drinkId === "string" && l.qty > 0);
  if (lines.length === 0) {
    throw new DomainError("请至少选择一杯饮品");
  }

  const drinks = await prisma.drink.findMany({
    where: { id: { in: lines.map((l) => l.drinkId) }, shopId: shop.id },
  });
  const byId = new Map(drinks.map((d) => [d.id, d]));
  for (const line of lines) {
    const d = byId.get(line.drinkId);
    if (!d) throw new DomainError("饮品不存在或已下架");
    if (!d.available) throw new DomainError(`「${d.name}」已售罄`);
    if (line.qty > 10) throw new DomainError("单品数量上限为 10 杯");
  }

  const totalCents = lines.reduce((sum, l) => {
    const d = byId.get(l.drinkId)!;
    return sum + d.priceCents * l.qty;
  }, 0);

  const startMakingAt = computeStartMakingAt(arrival, shop.prepMinutes);

  const mode = resolvePayMode();
  if (mode === PAY_MODE.MOCK_FAIL) {
    // 模拟支付失败：不落任何订单行，顾客可以直接重试（R-4）
    throw new DomainError("支付未成功，没有产生扣款。请重试，或直接到店点单。", 402);
  }

  try {
    const order = await prisma.order.create({
      data: {
        shopId: shop.id,
        status: ORDER_STATUS.PENDING, // 模拟支付：创建即已支付
        paidAt: new Date(),
        payMode: mode,
        clientToken,
        phoneTail: tail,
        customerName: optionalText(input.customerName),
        arrivalAt: arrival,
        startMakingAt,
        totalCents,
        note: optionalText(input.note),
        items: {
          create: lines.map((l) => {
            const d = byId.get(l.drinkId)!;
            return {
              drinkId: d.id,
              nameSnap: d.name,
              sizeSnap: d.size,
              priceCents: d.priceCents,
              qty: l.qty,
            };
          }),
        },
      },
      include: { items: true },
    });
    return { order, reused: false };
  } catch (err) {
    // 两个重试请求同时到达：一个建成功，另一个撞唯一约束。
    // 撞了就把已存在的那张单还回去，对顾客而言仍然是「一单」（R-2）
    if (clientToken && isUniqueViolation(err)) {
      const existing = await prisma.order.findUnique({
        where: { clientToken },
        include: { items: true },
      });
      if (existing) return { order: existing, reused: true };
    }
    throw err;
  }
}

/** 支付模式（模拟支付）：MOCK 恒成功；MOCK_FAIL 演练「支付失败」分支 */
export const PAY_MODE = { MOCK: "MOCK", MOCK_FAIL: "MOCK_FAIL" } as const;

function resolvePayMode(): string {
  const mode = (process.env.PAY_MODE ?? PAY_MODE.MOCK).trim().toUpperCase();
  if (mode !== PAY_MODE.MOCK && mode !== PAY_MODE.MOCK_FAIL) {
    throw new DomainError(`PAY_MODE 配置不正确：${mode}`, 500);
  }
  return mode;
}

/** 幂等键校验：格式不对宁可报错，也不静默降级成非幂等（R-2） */
function parseClientToken(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(raw)) {
    throw new DomainError("下单标识格式不正确，请刷新页面后重试");
  }
  return raw;
}

function optionalText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t.length > 0 ? t : null;
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "P2002";
}

/** 店员端队列：**按到店时刻排序**而非下单时刻（AC-5，本产品的核心机制） */
export async function getQueue() {
  const shop = await getShop();
  const [pending, making, ready] = await Promise.all([
    prisma.order.findMany({
      where: { shopId: shop.id, status: ORDER_STATUS.PENDING },
      include: { items: true },
      orderBy: { arrivalAt: "asc" },
    }),
    prisma.order.findMany({
      where: { shopId: shop.id, status: ORDER_STATUS.MAKING },
      include: { items: true },
      orderBy: { arrivalAt: "asc" },
    }),
    prisma.order.findMany({
      where: { shopId: shop.id, status: ORDER_STATUS.READY },
      include: { items: true },
      orderBy: { arrivalAt: "asc" },
    }),
  ]);

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const todays = await prisma.order.groupBy({
    by: ["status"],
    where: { shopId: shop.id, createdAt: { gte: startOfDay } },
    _count: { _all: true },
  });
  const countOf = (s: OrderStatus) =>
    todays.find((t) => t.status === s)?._count._all ?? 0;

  return {
    shop: {
      id: shop.id,
      name: shop.name,
      accepting: shop.accepting,
      prepMinutes: shop.prepMinutes,
    },
    pending,
    making,
    ready,
    stats: {
      todayTotal: todays.reduce((s, t) => s + t._count._all, 0),
      todayPending: countOf(ORDER_STATUS.PENDING),
      todayMaking: countOf(ORDER_STATUS.MAKING),
      todayReady: countOf(ORDER_STATUS.READY),
      todayPickedUp: countOf(ORDER_STATUS.PICKED_UP),
      todayCanceled: countOf(ORDER_STATUS.CANCELED),
    },
  };
}

/** 统一的流转入口：先校验状态机，再落库 */
async function transition(
  orderId: string,
  to: OrderStatus,
  extra: Record<string, unknown> = {},
) {
  const current = await prisma.order.findUnique({
    where: { id: orderId },
    select: { status: true },
  });
  if (!current) throw new DomainError("订单不存在", 404);

  const from = current.status as OrderStatus;
  try {
    assertTransition(from, to);
  } catch (err) {
    throw new DomainError((err as Error).message, 409);
  }

  // 并发安全的关键一步：状态必须**仍然**是刚读到的那个才允许写入。
  // 两个店员同时接单、顾客取消撞上店员接单、轮询超时取消撞上接单，
  // 都只有一个能写成功，另一个拿到 409 去刷新（阶段 3 / R-1）。
  const written = await prisma.order.updateMany({
    where: { id: orderId, status: from },
    data: { status: to, ...extra },
  });
  if (written.count === 0) {
    throw new DomainError("订单状态刚刚被其他人改动了，请刷新后重试", 409);
  }
  return prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: true },
  });
}

/** 接单（AC-5）；返回订单供 UI 展示，并盖上真实下料时刻 */
export async function acceptOrder(orderId: string) {
  const shop = await getShop();
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new DomainError("订单不存在", 404);

  // 到达时刻已过很久还挂着未接单的，按当下时刻下料，避免 retroactive 时刻
  const startMakingAt =
    order.startMakingAt && order.startMakingAt.getTime() > Date.now()
      ? order.startMakingAt
      : new Date();

  const updated = await transition(orderId, ORDER_STATUS.MAKING, {
    startMakingAt,
  });
  return { order: updated, prepMinutes: shop.prepMinutes };
}

/** 拒单（AC-7）；拒单即全额取消 */
export async function rejectOrder(orderId: string, reason: string) {
  const allowed = [CANCEL_REASON.REJECT_SOLD_OUT, CANCEL_REASON.REJECT_BUSY];
  const cancelReason = allowed.includes(reason as never)
    ? reason
    : CANCEL_REASON.REJECT_BUSY;
  return transition(orderId, ORDER_STATUS.CANCELED, {
    cancelReason,
    canceledAt: new Date(),
  });
}

/** 暂停 / 恢复接单（AC-6：店员控速，阿凯明确提出的需求） */
export async function setAccepting(accepting: boolean) {
  const shop = await getShop();
  return prisma.shop.update({
    where: { id: shop.id },
    data: { accepting },
  });
}

export async function updatePrepMinutes(prepMinutes: number) {
  const shop = await getShop();
  if (!Number.isInteger(prepMinutes) || prepMinutes < 1 || prepMinutes > 30) {
    throw new DomainError("制作时长需为 1-30 的整数（分钟）");
  }
  return prisma.shop.update({
    where: { id: shop.id },
    data: { prepMinutes },
  });
}

export async function markReady(orderId: string) {
  return transition(orderId, ORDER_STATUS.READY, { readyAt: new Date() });
}

export async function markPickedUp(orderId: string) {
  return transition(orderId, ORDER_STATUS.PICKED_UP, { pickedUpAt: new Date() });
}

/** 顾客在 2 分钟内取消（AC-4） */
export async function cancelByCustomer(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new DomainError("订单不存在", 404);
  if (!order.paidAt) throw new DomainError("该订单尚未支付", 409);

  const used = Date.now() - order.paidAt.getTime();
  if (used > FREE_CANCEL_MS) {
    throw new DomainError(
      `已超过 ${toMinute(FREE_CANCEL_MS)} 分钟免费取消时限，请联系店员`,
      409,
    );
  }
  return transition(orderId, ORDER_STATUS.CANCELED, {
    cancelReason: CANCEL_REASON.CUSTOMER,
    canceledAt: new Date(),
  });
}

/** 顾客「我快到了 / 请帮我留一下」（AC-12） */
export async function requestHold(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new DomainError("订单不存在", 404);
  if (
    order.status !== ORDER_STATUS.PENDING &&
    order.status !== ORDER_STATUS.MAKING
  ) {
    throw new DomainError("当前订单状态不支持此操作", 409);
  }
  return prisma.order.update({
    where: { id: orderId },
    data: { holdRequestedAt: new Date() },
    include: { items: true },
  });
}

/**
 * 超时未接单自动取消（AC-8）。
 * 无后台任务的环境下由客户端轮询触发；接 Vercel Cron 后可改为定时调用。
 * 幂等：已经流转走的订单不会被二次取消。
 */
export async function autoCancelStale() {
  const shop = await getShop();
  const deadline = new Date(Date.now() - AUTO_CANCEL_MS);
  const stale = await prisma.order.findMany({
    where: {
      shopId: shop.id,
      status: ORDER_STATUS.PENDING,
      paidAt: { lt: deadline },
    },
    select: { id: true },
  });
  let canceled = 0;
  for (const s of stale) {
    try {
      await transition(s.id, ORDER_STATUS.CANCELED, {
        cancelReason: CANCEL_REASON.TIMEOUT,
        canceledAt: new Date(),
      });
      canceled++;
    } catch {
      // 并发下已被处理，跳过即可
    }
  }
  return { checked: stale.length, canceled };
}

export async function getOrder(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });
  if (!order) throw new DomainError("订单不存在", 404);
  return order;
}

/**
 * 需要「预计做好」时刻时统一从这里取，保证顾客端与店员端一致（AC-3）。
 *
 * 注意：按核心机制，下料时刻 = 到店时刻 − T，因此「做好」时刻**就是到店时刻**。
 * 这里不要用 DEFAULT_PREP_MINUTES 去反推，否则会引入与 Shop.prepMinutes 不一致的
 * 第二套真相来源——这是本项目最容易写出 bug 的地方。
 */
export function expectedReadyAt(order: { arrivalAt: Date }): Date {
  return order.arrivalAt;
}
