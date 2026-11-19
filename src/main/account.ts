import { ipcMain } from 'electron'
import { DEVICE_TYPE, type AuthResult } from '../shared/auth'
import type { AccountProfile } from '../shared/account'
import { getDeviceId } from './auth-device'
import { getAccessToken } from './auth'
import { postForm } from './http'
import { refreshBalance } from './billing'

/** 个人中心：查询账号信息（含剩余时长）与卡密充值 */

function readNumber(source: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))) {
      return Number(value)
    }
  }
  return 0
}

function readText(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value) return value
  }
  return ''
}

function parseProfile(data: unknown): AccountProfile | null {
  if (!data || typeof data !== 'object') return null
  const source = data as Record<string, unknown>
  const id = readNumber(source, ['accountId', 'id'])
  return {
    accountId: id || null,
    account: readText(source, ['account', 'username']),
    nickname: readText(source, ['nickname', 'nickName']),
    trialSecondsLeft: readNumber(source, ['trialSecondsLeft', 'trialSeconds', 'trialTimeLeft']),
    // 服务端目前只有总剩余字段 remainingTime，归入付费时长展示
    paidSecondsLeft: readNumber(source, [
      'paidSecondsLeft',
      'paidSeconds',
      'secondsLeft',
      'remainingTime'
    ])
  }
}

async function fetchProfile(): Promise<AccountProfile | null> {
  const token = getAccessToken()
  if (!token) return null
  const deviceId = await getDeviceId()
  const result = await postForm('/api/account/profile', { deviceId }, token)
  if (!result.ok) {
    console.error('[account] profile failed:', result.message)
    return null
  }
  return parseProfile(result.data)
}

ipcMain.handle('account:get-profile', async () => {
  const profile = await fetchProfile()
  return { ok: !!profile, message: profile ? 'success' : '获取账号信息失败', profile }
})

ipcMain.handle(
  'account:redeem',
  async (_event, cardCode: string): Promise<AuthResult & { profile?: AccountProfile | null }> => {
    const token = getAccessToken()
    if (!token) return { ok: false, message: '未登录，请重新登录' }
    const deviceId = await getDeviceId()
    const result = await postForm(
      '/api/account/recharge',
      { deviceId, deviceType: DEVICE_TYPE, code: cardCode.trim().toUpperCase() },
      token
    )
    if (!result.ok) {
      return { ok: false, message: result.message }
    }
    // 充值成功后重新拉余额，以服务端为准；同步刷新计费模块的顶栏余额
    const profile = await fetchProfile()
    void refreshBalance()
    return { ok: true, message: result.message || '充值成功', profile }
  }
)
