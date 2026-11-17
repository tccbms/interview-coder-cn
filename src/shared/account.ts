/** 个人中心：账号信息与卡密充值。纯 TS，主进程与 preload 共用 */

export interface AccountProfile {
  accountId: number | null
  account: string
  nickname: string
  /** 剩余试用秒数 */
  trialSecondsLeft: number
  /** 剩余付费秒数 */
  paidSecondsLeft: number
}

export interface AccountResult {
  ok: boolean
  message: string
  /** 成功时带上最新账号信息（充值后直接刷新界面） */
  profile?: AccountProfile | null
}
