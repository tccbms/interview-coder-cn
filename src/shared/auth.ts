/**
 * 账号密码登录：共享类型、常量。
 *
 * 纯 TS，不引入 Electron / DOM / Node API，供主进程与 preload 引用。
 * 渲染层（LoginPage）不 import 此文件（vite renderer 无 @shared alias），
 * 所需类型在那里内联定义。
 */

/** 设备类型，固定值 3（form 表单一律按字符串提交） */
export const DEVICE_TYPE = '3' as const

/** 接口基址：登录、用户信息、远程配置 */
export const API_BASE_URL = 'http://oa.feilong520.top'

/** 统一请求结果：HTTP 层和业务层失败都压成同一种形状 */
export interface AuthResult {
  ok: boolean
  message: string
  /** 服务端 data 字段；http.ts 已把 JSON 字符串还原成对象 */
  data?: unknown
}

/** 启动校验失败的原因，用于登录页顶部提示分流；none 表示首次打开无提示 */
export type LoginFailureReason = 'none' | 'unauthorized' | 'network'

/** 主进程推给登录页的失败上下文 */
export interface LoginReasonPayload {
  reason: LoginFailureReason
  message: string
}

/** 把 deviceId 脱敏成「前 8 位 + …」用于日志 */
export function maskDeviceId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id
}
