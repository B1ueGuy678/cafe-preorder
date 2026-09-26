// 时间与关键机制 · 阶段 2
// 本产品唯一真正区别于普通点单小程序的地方，就在这两个函数里。

/** 到店时刻粒度：5 分钟（AC-2） */
export const ARRIVAL_SLOT_MINUTES = 5;

/** 订单超时未接单自动取消的阈值（毫秒）——3 分钟（AC-8） */
export const AUTO_CANCEL_MS = 3 * 60 * 1000;

/** 顾客下单后无理由取消的窗口（毫秒）——2 分钟（AC-4） */
export const FREE_CANCEL_MS = 2 * 60 * 1000;

/** 默认制作时长 T（分钟），店员端可覆盖（写进 Shop.prepMinutes） */
export const DEFAULT_PREP_MINUTES = 3;

/** 顾客可通过「我快到了」提前催单的窗口（毫秒） */
export const HOLD_WINDOW_MS = 15 * 60 * 1000;

export function toMinute(ms: number): number {
  return Math.round(ms / 60000);
}

/** 生成从 from 向后 count 个 5 分钟粒度的到店时刻 */
export function buildArrivalSlots(
  from: Date,
  count = 6,
  extraSlotsBefore = 1,
): Date[] {
  const base = ceilToSlot(from);
  const slots: Date[] = [];
  for (let i = -extraSlotsBefore; i < count; i++) {
    slots.push(new Date(base.getTime() + i * ARRIVAL_SLOT_MINUTES * 60000));
  }
  return slots.filter((d) => d.getTime() > from.getTime() - 60000);
}

/** 向上取整到 5 分钟粒度 */
export function ceilToSlot(date: Date, slot = ARRIVAL_SLOT_MINUTES): Date {
  const ms = slot * 60000;
  return new Date(Math.ceil(date.getTime() / ms) * ms);
}

/** 向下取整到 5 分钟粒度 */
export function floorToSlot(date: Date, slot = ARRIVAL_SLOT_MINUTES): Date {
  const ms = slot * 60000;
  return new Date(Math.floor(date.getTime() / ms) * ms);
}

/** 到店时刻是否落在允许的 5 分钟粒度上（AC-2 的服务端校验） */
export function isOnSlot(date: Date, slot = ARRIVAL_SLOT_MINUTES): boolean {
  return date.getTime() % (slot * 60000) === 0;
}

/**
 * 核心机制：由到达时刻倒推下料时刻。
 * 下料时刻 = 到店时刻 − 制作时长 T
 *
 * 这一行就是「提前点=凉」变成「准点到=刚好做好」的全部秘密。
 */
export function computeStartMakingAt(
  arrivalAt: Date,
  prepMinutes: number,
): Date {
  return new Date(arrivalAt.getTime() - prepMinutes * 60000);
}

/** 预计做好时刻 = 下料时刻 + T = 到店时刻（对顾客而言就是「你到的时候刚好」） */
export function computeExpectedReadyAt(
  arrivalAt: Date,
  prepMinutes: number,
): Date {
  return new Date(
    computeStartMakingAt(arrivalAt, prepMinutes).getTime() +
      prepMinutes * 60000,
  );
}

export function formatHHmm(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** 剩余毫秒；已过则返回 0 */
export function remainingMs(deadline: Date, now = new Date()): number {
  return Math.max(0, deadline.getTime() - now.getTime());
}

export function remainingText(deadline: Date, now = new Date()): string {
  const ms = remainingMs(deadline, now);
  if (ms === 0) return "已超时";
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;
}

export function centsToYuan(cents: number): string {
  return `¥${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
}
