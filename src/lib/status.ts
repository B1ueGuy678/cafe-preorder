// 订单状态机 · 全项目唯一的状态真相来源
// 依据：docs/PRODUCT.md 第 4 节 AC-14（终态不可再次流转）
//
//   UNPAID ──支付──► PENDING ──接单──► MAKING ──做好──► READY ──取餐──► PICKED_UP(终态)
//                      │                │                │
//                  拒单/超时         顾客取消          顾客取消
//                      ▼                ▼                ▼
//                   CANCELED(终态)   CANCELED          CANCELED

export const ORDER_STATUS = {
  UNPAID: "UNPAID",
  PENDING: "PENDING",
  MAKING: "MAKING",
  READY: "READY",
  PICKED_UP: "PICKED_UP",
  CANCELED: "CANCELED",
} as const;

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

/** 终态：进入后不允许再流转（AC-14） */
export const TERMINAL_STATUSES: OrderStatus[] = [
  ORDER_STATUS.PICKED_UP,
  ORDER_STATUS.CANCELED,
];

/** 合法流转表：未列出的流转一律拒绝 */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  UNPAID: [ORDER_STATUS.PENDING, ORDER_STATUS.CANCELED],
  PENDING: [ORDER_STATUS.MAKING, ORDER_STATUS.CANCELED],
  MAKING: [ORDER_STATUS.READY, ORDER_STATUS.CANCELED],
  READY: [ORDER_STATUS.PICKED_UP, ORDER_STATUS.CANCELED],
  PICKED_UP: [],
  CANCELED: [],
};

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * 断言流转合法。非法流转必须抛错而不是静默忽略——
 * 这是防止「已取消订单被接单」这类脏数据的关键防线。
 */
export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(
      `非法状态流转：${from} → ${to}${isTerminal(from) ? "（源状态为终态）" : ""}`,
    );
  }
}

export const CANCEL_REASON = {
  TIMEOUT: "TIMEOUT", // 超时未接单，系统自动取消（AC-8）
  REJECT_SOLD_OUT: "REJECT_SOLD_OUT", // 店员拒单：售罄
  REJECT_BUSY: "REJECT_BUSY", // 店员拒单：忙不过来
  CUSTOMER: "CUSTOMER", // 顾客自行取消（AC-4）
} as const;

export type CancelReason = (typeof CANCEL_REASON)[keyof typeof CANCEL_REASON];

/** 面向顾客/店员的中文文案，避免在 UI 里散落判断 */
export const STATUS_LABEL: Record<OrderStatus, string> = {
  UNPAID: "待支付",
  PENDING: "待接单",
  MAKING: "制作中",
  READY: "已做好",
  PICKED_UP: "已取餐",
  CANCELED: "已取消",
};

export const CANCEL_REASON_LABEL: Record<string, string> = {
  TIMEOUT: "超时未接单",
  REJECT_SOLD_OUT: "售罄",
  REJECT_BUSY: "店内忙不过来",
  CUSTOMER: "顾客取消",
};
