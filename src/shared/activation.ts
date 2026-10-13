/**
 * 激活码激活与启动校验：共享类型、常量与清洗函数。
 *
 * 纯 TS，不引入 Electron / DOM / Node API，供主进程与 preload 引用。
 * 渲染层（ActivationPage）不 import 此文件（vite renderer 无 @shared alias），
 * 所需类型在那里内联定义。
 */

/**
 * 设备类型，固定值 3。
 *
 * 注意：需求文档写「number，不允许写成字符串 "3"」，但服务端实际实现
 * 期望字符串——curl 实测 active 接口传 number 3 报「deviceType is empty」，
 * 传字符串 "3" 才通过校验。check 接口两者都接受。因此这里用字符串。
 */
export const DEVICE_TYPE = '3' as const

/** 激活 / 校验接口基址 */
export const ACTIVATION_BASE_URL = 'http://oa.feilong520.top'

/** 统一请求结果：HTTP 层和业务层失败都压成同一种形状 */
export interface ActivationResult {
  ok: boolean
  message: string
  /** 服务端 data 字段，可能为 null / 对象 / 字符串 / 不存在；透传，调用方判空 */
  data?: unknown
}

/** 持久化到磁盘的激活状态 */
export interface ActivationStatus {
  deviceId: string
  /** 是否曾经激活成功过（仅作提示文案用，不替代服务端校验） */
  activated: boolean
  /** 上次校验通过的时间戳（ms） */
  lastCheckedAt?: number
}

/** 启动校验失败的原因，用于激活页顶部提示分流 */
export type ActivationFailureReason = 'expired' | 'network'

/** 主进程推给激活页的失败上下文 */
export interface ActivationReasonPayload {
  reason: ActivationFailureReason
  message: string
  previouslyActivated: boolean
}

/** 去首尾空格 + 全角转半角（ASCII 可打印范围 FF01..FF5E → 0021..007E） */
export function cleanActivationCode(code: string): string {
  return code
    .trim()
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
}

/** 把 deviceId 脱敏成「前 8 位 + …」用于日志 */
export function maskDeviceId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id
}
