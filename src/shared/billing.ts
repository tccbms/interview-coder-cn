/**
 * 计时计费：共享类型与常量。
 *
 * 纯 TS，不引入 Electron / DOM / Node API，供主进程与 preload 引用。
 * 渲染层通过 preload 暴露的 IPC 拿到这些类型，不直接 import 本文件
 * （vite renderer 无 @shared alias，做法与 src/shared/account.ts 一致）。
 *
 * 契约权威：docs/计费接口文档.md。服务端基址复用 src/shared/auth.ts 的 API_BASE_URL。
 */

/** 结束会话的原因，与后端约定一致 */
export type BillingSessionReason =
  | 'user' // 手动停止（停止监听 / 登出）
  | 'idle' // 空闲 300s
  | 'quit' // 退出应用
  | 'exhausted' // 余额耗尽
  | 'timeout' // 服务端超时 / 达 4h 上限
  | 'superseded' // 被顶号（同账号另一设备开始）

/** 主进程推给渲染层的计费状态快照 */
export interface BillingState {
  /** 是否有活跃计费会话 */
  sessionActive: boolean
  /** 服务端权威剩余时长（秒） */
  remainingSeconds: number
  /** 余额是否耗尽（为 true 时禁止新截图 / 新监听） */
  exhausted: boolean
  /** 本次会话已用秒数（本地估算，仅展示） */
  sessionSeconds: number
  /** 上次结算的取整后计费秒数，用于一次性提示；0 表示无 */
  lastBilledSeconds: number
}

/** 主进程推给渲染层的一次性提示（toast） */
export interface BillingNotice {
  message: string
  kind: 'info' | 'warn' | 'error'
}

/** 业务错误码，与 docs/计费接口文档.md §0 对齐 */
export const BILLING_CODES = {
  /** 余额不足 */
  INSUFFICIENT: 2001,
  /** 会话已失效（被顶号 / 已结算 / 超时清理） */
  SESSION_INVALID: 2002,
  /** 会话不存在 */
  SESSION_MISSING: 2003,
  /** 会话已达单次上限（4 小时） */
  LIMIT_REACHED: 2004,
  /** 卡密不可用 */
  CARD_INVALID: 2005
} as const

/** 心跳返回的会话状态 */
export type HeartbeatStatus = 'active' | 'exhausted' | 'expired'

/** start 响应 data（未知字段忽略，时长兼容 number/string） */
export interface StartSessionData {
  sessionId?: unknown
  startedAt?: unknown
  heartbeatInterval?: unknown
  idleTimeoutSeconds?: unknown
  remainingTime?: unknown
  serverTime?: unknown
  previousSessionClosed?: unknown
}

/** heartbeat 响应 data */
export interface HeartbeatData {
  remainingTime?: unknown
  chargedSeconds?: unknown
  chargedTotalSeconds?: unknown
  status?: unknown
  shouldStop?: unknown
  serverTime?: unknown
}

/** end 响应 data */
export interface EndSessionData {
  chargedTotalSeconds?: unknown
  billedSeconds?: unknown
  chargedSeconds?: unknown
  remainingTime?: unknown
  serverTime?: unknown
}

/** 登录失效判定：HTTP 401 或业务 code 401/40101 */
export function isAuthExpired(code: number | undefined): boolean {
  return code === 401 || code === 40101
}
