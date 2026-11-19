import { app, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { postForm } from './http'
import { getAccessToken } from './auth'
import { getDeviceId } from './auth-device'
import {
  BILLING_CODES,
  isAuthExpired,
  type BillingNotice,
  type BillingSessionReason,
  type BillingState
} from '../shared/billing'

/**
 * 计时计费状态机（side-effect 单例）：
 * - 截图模式首次截图 / 对话模式开始监听 → ensureSessionStarted() 调 start 开会话
 * - 会话存活期间按 heartbeatInterval 发心跳，用响应 remainingTime 刷新余额
 * - 空闲 idleTimeoutSeconds（默认 300s）/ 停止监听 / 退出 / 登出 / 耗尽 → endSession 结算
 * - 断网 180s 宽限：退避重试；超时本地结束（服务端定时任务兜底结算）
 *
 * 契约：docs/计费接口文档.md。本模块只动计费相关逻辑，不碰窗口/AI/截图。
 */

// ---- 模块级状态 ----
let currentSessionId: string | null = null
let seq = 0
let sessionActive = false
let remainingSeconds = 0
let remainingUpdatedAt = 0 // 上次从服务端拿到 remainingSeconds 的本地时刻
let exhausted = false
let sessionStartedAt = 0 // ms，本地计时用于 sessionSeconds 展示
let lastBilledSeconds = 0
let lastGateMessage = '' // 上一次开启会话失败的原因，供截图模式展示真实错误
let heartbeatIntervalMs = 60_000
let idleTimeoutMs = 300_000
let heartbeatTimer: ReturnType<typeof setTimeout> | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null
let limitTimer: ReturnType<typeof setTimeout> | null = null // 余额用完的本地定时器
let networkDownAt: number | null = null
let retryAttempts = 0
let ending = false // endSession 重入守卫
let quitting = false // before-quit 防重入

const GRACE_MS = 180_000 // 断网宽限 180s
const QUIT_SAFETY_MS = 6_000 // 退出结算兜底超时

// ---- 工具 ----
function sendToRenderer(channel: string, ...args: unknown[]): void {
  const mainWindow = global.mainWindow
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

function asRecord(data: unknown): Record<string, unknown> {
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
}

/** 兼容 number / 字符串数字读时长（秒）；缺失返回 0 */
function readNumber(source: Record<string, unknown>, keys: string[]): number {
  return readOptionalNumber(source, keys) ?? 0
}

/**
 * 读时长（秒）；缺失 / null / 非数字返回 null。
 * start 接口可能返回 remainingTime=null（余额以 profile 为准），不能当成 0 误判耗尽
 */
function readOptionalNumber(source: Record<string, unknown>, keys: string[]): number | null {
  const key = keys.find((k) => k in source)
  if (key === undefined) return null
  const value = source[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))) {
    return Number(value)
  }
  return null
}

/** 上一次 ensureSessionStarted 失败的真实原因；成功后清空 */
export function getSessionGateMessage(): string {
  return lastGateMessage
}

function snapshot(): BillingState {
  const sessionSeconds =
    sessionActive && sessionStartedAt > 0
      ? Math.max(0, Math.floor((Date.now() - sessionStartedAt) / 1000))
      : 0
  return {
    sessionActive,
    remainingSeconds: effectiveRemaining(),
    exhausted,
    sessionSeconds,
    lastBilledSeconds
  }
}

/**
 * 本地估算的剩余秒数：以最近一次服务端值为基准，按墙上时间递减。
 * 用于界面展示与本地上限门禁，服务端仍以心跳扣费为准。
 */
function effectiveRemaining(): number {
  if (!sessionActive) return Math.max(0, remainingSeconds)
  const elapsed = Math.floor((Date.now() - remainingUpdatedAt) / 1000)
  return Math.max(0, remainingSeconds - Math.max(0, elapsed))
}

function broadcast(): void {
  sendToRenderer('billing:update', snapshot())
}

function broadcastNotice(kind: BillingNotice['kind'], message: string): void {
  const notice: BillingNotice = { message, kind }
  sendToRenderer('billing:notice', notice)
}

function clearTimers(): void {
  if (heartbeatTimer) {
    clearTimeout(heartbeatTimer)
    heartbeatTimer = null
  }
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  if (limitTimer) {
    clearTimeout(limitTimer)
    limitTimer = null
  }
}

/** 通知渲染层：余额用完，请充值（渲染层据此拦截功能并跳到个人中心） */
function emitRechargeRequired(): void {
  sendToRenderer('billing:recharge-required')
}

/**
 * 本地余额归零定时器：不等下一次心跳，到点立即结算并禁用功能。
 * 心跳每次刷新余额后会重排。
 */
function scheduleLimit(): void {
  if (limitTimer) {
    clearTimeout(limitTimer)
    limitTimer = null
  }
  if (!sessionActive) return
  const ms = effectiveRemaining() * 1000
  if (ms <= 0) {
    exhaustSession()
    return
  }
  limitTimer = setTimeout(() => {
    exhaustSession()
  }, ms)
}

/** 余额用完：立即结束计费会话、置耗尽态、弹提示并引导充值 */
function exhaustSession(): void {
  if (!sessionActive || exhausted) return
  exhausted = true
  remainingSeconds = 0
  void endSession('exhausted')
  emitRechargeRequired()
  broadcast()
}

function scheduleHeartbeat(delayMs: number): void {
  if (heartbeatTimer) clearTimeout(heartbeatTimer)
  heartbeatTimer = setTimeout(() => {
    void heartbeatTick()
  }, delayMs)
}

function resetIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    void endSession('idle')
  }, idleTimeoutMs)
}

function formatBilledMinutes(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60))
  return `${minutes} 分钟`
}

// ---- 余额 ----
/** 读 profile 的 remainingTime（秒）；请求失败或字段缺失返回 null */
async function fetchProfileRemaining(token: string): Promise<number | null> {
  const deviceId = await getDeviceId()
  const result = await postForm('/api/account/profile', { deviceId }, token)
  if (!result.ok) return null
  return readOptionalNumber(asRecord(result.data), ['remainingTime'])
}

/** 拉 profile 的 remainingTime 刷新本地余额；会话活跃时以心跳为准，不覆盖 */
export async function refreshBalance(): Promise<void> {
  const token = getAccessToken()
  if (!token) return
  const seconds = await fetchProfileRemaining(token)
  if (seconds === null) return
  if (sessionActive) {
    broadcast()
    return
  }
  remainingSeconds = Math.max(0, seconds)
  exhausted = remainingSeconds <= 0
  broadcast()
}

// ---- 会话开始 ----
function markExhausted(message: string): void {
  exhausted = true
  sessionActive = false
  currentSessionId = null
  remainingSeconds = 0
  clearTimers()
  lastGateMessage = message
  emitRechargeRequired()
  broadcast()
}

/** 确保有活跃会话；已活跃直接返回 true。失败返回 false（已广播提示） */
export async function ensureSessionStarted(): Promise<boolean> {
  console.log('[billing] ensureSessionStarted entry:',
    'sessionActive=', sessionActive,
    'exhausted=', exhausted,
    'remainingSeconds=', remainingSeconds,
    'effectiveRemaining=', effectiveRemaining())

  if (sessionActive) {
    if (effectiveRemaining() > 0) {
      console.log('[billing] sessionActive + remaining>0 → allow')
      return true
    }
    console.log('[billing] sessionActive but remaining<=0 → endSession+markExhausted')
    void endSession('exhausted')
    markExhausted('余额不足，请充值')
    return false
  }
  if (exhausted) {
    console.log('[billing] exhausted=true → block')
    lastGateMessage = '余额不足，请充值'
    emitRechargeRequired()
    broadcast()
    return false
  }
  const token = getAccessToken()
  if (!token) {
    console.log('[billing] no token → block')
    lastGateMessage = '未登录，请重新登录'
    broadcastNotice('error', lastGateMessage)
    return false
  }

  const sessionId = randomUUID()
  const result = await postForm('/api/account/start', { sessionId, seq: '0' }, token)
  console.log('[billing] start API result:', 'ok=', result.ok, 'code=', result.code, 'msg=', result.message, 'data=', JSON.stringify(result.data ?? {}))
  if (!result.ok) {
    if (
      result.code === BILLING_CODES.INSUFFICIENT ||
      /余额不足|时长不足/.test(result.message || '')
    ) {
      console.log('[billing] start INSUFFICIENT → markExhausted')
      markExhausted('余额不足，请充值')
      return false
    }
    if (isAuthExpired(result.code)) {
      lastGateMessage = result.message || '登录已过期，请重新登录'
      broadcastNotice('error', lastGateMessage)
      return false
    }
    lastGateMessage = result.message || '无法开始使用，请检查网络后重试'
    broadcastNotice('error', lastGateMessage)
    return false
  }

  const data = asRecord(result.data)
  let remaining = readOptionalNumber(data, ['remainingTime'])
  console.log('[billing] start parsed remainingTime=', remaining)
  if (remaining === null) {
    remaining = await fetchProfileRemaining(token)
    console.log('[billing] profile fetch remaining=', remaining)
    if (remaining !== null && remaining <= 0) {
      console.log('[billing] profile remaining<=0 → markExhausted')
      markExhausted('余额不足，请充值')
      return false
    }
  } else if (remaining <= 0) {
    console.log('[billing] start remaining<=0 → markExhausted')
    markExhausted('余额不足，请充值')
    return false
  }

  currentSessionId = sessionId
  seq = 0
  sessionActive = true
  exhausted = false
  if (remaining === null) {
    console.log('[billing] both start+profile gave null → async profile pull, allow for now')
    void fetchProfileRemaining(token).then((r) => {
      console.log('[billing] async profile refresh:', r)
      if (r === null) return
      remainingSeconds = Math.max(0, r)
      remainingUpdatedAt = Date.now()
      if (remainingSeconds <= 0) {
        console.log('[billing] async profile shows 0 → exhaust mid-session')
        exhausted = true
        void endSession('exhausted')
        emitRechargeRequired()
      }
      broadcast()
    })
  } else {
    remainingSeconds = Math.max(0, remaining)
  }
  remainingUpdatedAt = Date.now()
  lastGateMessage = ''
  sessionStartedAt = Date.now()
  lastBilledSeconds = 0
  networkDownAt = null
  retryAttempts = 0
  heartbeatIntervalMs = Math.max(10_000, readNumber(data, ['heartbeatInterval']) * 1000 || 60_000)
  idleTimeoutMs = Math.max(60_000, readNumber(data, ['idleTimeoutSeconds']) * 1000 || 300_000)

  resetIdleTimer()
  scheduleHeartbeat(heartbeatIntervalMs)
  scheduleLimit()
  broadcast()
  return true
}

// ---- 活动 ----
/** 有使用行为（截图 / 对话句子 / 提示）→ 重置空闲计时 */
export function notifyActivity(): void {
  if (!sessionActive) return
  resetIdleTimer()
}

// ---- 心跳 ----
async function heartbeatTick(): Promise<void> {
  if (!sessionActive || !currentSessionId) return
  const token = getAccessToken()
  if (!token) {
    await endSessionLocal()
    return
  }

  // seq 只在发送成功后推进；失败重试复用同一 seq，服务端幂等
  const nextSeq = seq + 1
  const result = await postForm(
    '/api/account/heartbeat',
    { sessionId: currentSessionId, seq: String(nextSeq) },
    token
  )
  if (!sessionActive) return // 等待期间会话已结束

  if (result.ok) {
    seq = nextSeq
    const data = asRecord(result.data)
    remainingSeconds = Math.max(0, readNumber(data, ['remainingTime']))
    remainingUpdatedAt = Date.now()
    networkDownAt = null
    retryAttempts = 0

    const shouldStop = data.shouldStop === true
    const status = typeof data.status === 'string' ? data.status : ''
    broadcast()

    // 余额为 0 也必须立即停止：部分后端只把 remainingTime 扣到 0，
    // 并不返回 shouldStop / status=exhausted
    if (shouldStop || status === 'exhausted' || remainingSeconds <= 0) {
      exhausted = true
      remainingSeconds = 0
      await endSession('exhausted')
      emitRechargeRequired()
      broadcast()
      return
    }
    if (status === 'expired') {
      await endSession('timeout')
      broadcastNotice('warn', '本次使用已达上限，已结束计费')
      return
    }
    scheduleHeartbeat(heartbeatIntervalMs)
    scheduleLimit()
    return
  }

  // 失败分支
  if (
    result.code === BILLING_CODES.SESSION_INVALID ||
    result.code === BILLING_CODES.SESSION_MISSING
  ) {
    await endSession('superseded')
    broadcastNotice('warn', '账号已在其他设备登录，本次使用已结束')
    return
  }
  if (result.code === BILLING_CODES.LIMIT_REACHED) {
    await endSession('timeout')
    broadcastNotice('warn', '本次使用已达上限，已结束计费')
    return
  }
  if (isAuthExpired(result.code)) {
    await endSessionLocal()
    broadcastNotice('error', '登录已过期，请重新登录')
    return
  }

  // 本地余额已经归零 / 服务端明确说余额不足：不再宽限，立即结算并禁用
  const message = result.message || ''
  if (effectiveRemaining() <= 0 || /余额不足|时长不足/.test(message)) {
    exhausted = true
    remainingSeconds = 0
    await endSession('exhausted')
    emitRechargeRequired()
    broadcast()
    return
  }

  // 服务端已判定会话结束（余额为 0 / 被清理）：本地同步结束，下次使用重新 start
  if (/会话已结束|会话不存在|会话已失效/.test(message)) {
    await endSessionLocal()
    broadcastNotice('warn', '本次使用已结束，如需继续请重新开始')
    return
  }

  // 网络 / 500：180s 宽限内退避重试，保持会话
  const now = Date.now()
  if (networkDownAt === null) networkDownAt = now
  if (now - networkDownAt > GRACE_MS) {
    await endSessionLocal()
    broadcastNotice('warn', '网络连接中断，本次使用已结束')
    return
  }
  retryAttempts += 1
  scheduleHeartbeat(Math.min(30_000, 10_000 * retryAttempts))
}

// ---- 会话结束 ----
/** 调 end 结算；幂等。失败则本地清状态，由服务端定时任务兜底结算 */
export async function endSession(reason: BillingSessionReason): Promise<void> {
  if (!sessionActive || ending) return
  ending = true
  clearTimers()

  const sessionId = currentSessionId
  const finalSeq = seq
  sessionActive = false // 先置非活跃，允许并发开启新会话

  const token = getAccessToken()
  if (sessionId && token) {
    const result = await postForm(
      '/api/account/end',
      { sessionId, seq: String(finalSeq), reason },
      token
    )
    // 仅当未被新会话取代时才写回余额，避免覆盖新会话的数据
    if (result.ok && currentSessionId === sessionId) {
      const data = asRecord(result.data)
      remainingSeconds = Math.max(0, readNumber(data, ['remainingTime']))
      lastBilledSeconds = readNumber(data, ['billedSeconds'])
      if (lastBilledSeconds > 0 && (reason === 'user' || reason === 'idle')) {
        broadcastNotice('info', `本次使用 ${formatBilledMinutes(lastBilledSeconds)}，已结算`)
      }
    }
  }

  if (currentSessionId === sessionId) {
    currentSessionId = null
    seq = 0
  }
  networkDownAt = null
  retryAttempts = 0
  ending = false
  broadcast()
}

/** 本地结束（不调 end）：断网超时放弃时使用，服务端定时任务兜底结算 */
async function endSessionLocal(): Promise<void> {
  if (!sessionActive || ending) return
  ending = true
  clearTimers()
  sessionActive = false
  currentSessionId = null
  seq = 0
  networkDownAt = null
  retryAttempts = 0
  ending = false
  broadcast()
}

/** 登出时结束会话（reason=user）；失败也不阻塞登出 */
export async function endSessionForLogout(): Promise<void> {
  await endSession('user')
}

/**
 * 登出后清空运行时计费状态。不调 end API——调用方应先 endSessionForLogout。
 * 避免旧用户的余额 / 耗尽标志残留到下一次登录：否则 exhausted=true 会让
 * ensureSessionStarted 在 L152 短路，而唯一清零路径（start 成功 / refreshBalance）
 * 又被它挡住，形成自锁死，有效用户被永久拦截至重启应用。
 */
export function resetBillingState(): void {
  clearTimers()
  sessionActive = false
  currentSessionId = null
  seq = 0
  remainingSeconds = 0
  remainingUpdatedAt = 0
  exhausted = false
  sessionStartedAt = 0
  lastBilledSeconds = 0
  networkDownAt = null
  retryAttempts = 0
  ending = false
  broadcast()
}

// ---- 生命周期 ----
// 退出应用：有活跃会话时先异步结算再退出，6s 兜底强制退出
app.on('before-quit', (e) => {
  if (quitting || !sessionActive) return
  e.preventDefault()
  quitting = true
  const safety = setTimeout(() => app.exit(0), QUIT_SAFETY_MS)
  endSession('quit').finally(() => {
    clearTimeout(safety)
    app.quit()
  })
})

// 启动后种子余额（主窗口创建后广播可达）
app.whenReady().then(() => {
  if (getAccessToken()) void refreshBalance()
})

// ---- IPC ----
ipcMain.handle('billing:get-state', () => snapshot())
ipcMain.handle('billing:refresh', async () => {
  await refreshBalance()
  return snapshot()
})
