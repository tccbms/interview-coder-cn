import { useCallback, useEffect, useState } from 'react'
import { Clock3, ExternalLink, LogOut, RefreshCw, Ticket, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field, SettingsCard } from '../components'
import { useAppStore } from '@/lib/store/app'
import type { AccountProfile } from '../../../../shared/account'

/** 秒数 → 「1 小时 30 分钟」 */
function formatSeconds(seconds: number): string {
  if (seconds <= 0) return '0 分钟'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h && m) return `${h} 小时 ${m} 分钟`
  if (h) return `${h} 小时`
  if (m) return `${m} 分钟`
  return `${seconds} 秒`
}

/** 个人中心：账号信息、剩余时长、卡密充值、退出登录 */
export function AccountSection() {
  const [profile, setProfile] = useState<AccountProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [cardCode, setCardCode] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  // 服务端下发的网页充值地址（/api/account/config 的 rechargeUrl）
  const rechargeUrl = useAppStore((state) => state.rechargeUrl)

  const refresh = useCallback(async () => {
    setLoading(true)
    const result = await window.api.accountGetProfile()
    setProfile(result.profile ?? null)
    setLoading(false)
    if (!result.ok) toast.error(result.message)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const redeem = async () => {
    const code = cardCode.trim()
    if (!code || redeeming) return
    setRedeeming(true)
    try {
      const result = await window.api.accountRedeem(code)
      if (result.ok) {
        toast.success(result.message || '充值成功')
        setCardCode('')
        if (result.profile) setProfile(result.profile)
      } else {
        toast.error(result.message || '充值失败')
      }
    } finally {
      setRedeeming(false)
    }
  }

  const totalSeconds = (profile?.trialSecondsLeft ?? 0) + (profile?.paidSecondsLeft ?? 0)

  return (
    <>
      <SettingsCard
        Icon={UserRound}
        title="个人中心"
        extra={
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-7 w-7"
            onClick={refresh}
            title="刷新"
          >
            <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label="账号">
            <span className="text-sm text-gray-700">
              {profile
                ? profile.nickname || profile.account || '—'
                : loading
                  ? '加载中…'
                  : '未获取到'}
            </span>
          </Field>
          <Field label="剩余时长">
            <span className="text-sm font-semibold text-gray-900">
              {profile ? formatSeconds(totalSeconds) : '—'}
            </span>
          </Field>
        </div>
      </SettingsCard>

      <SettingsCard
        Icon={Ticket}
        title="卡密充值"
        extra={
          rechargeUrl ? (
            <a
              href={rechargeUrl}
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex h-7 items-center gap-1 rounded-md bg-red-600 px-2 text-xs font-medium text-white hover:bg-red-500"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              充值联系
            </a>
          ) : null
        }
      >
        <div className="space-y-3">
          <Field label="卡密" note="充值成功后立即到账">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={cardCode}
                onChange={(e) => setCardCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void redeem()
                }}
                placeholder="请输入卡密"
                disabled={redeeming}
                spellCheck={false}
                className="w-56 px-3 py-2 border border-gray-300 rounded-md bg-white text-sm uppercase focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              />
              <Button size="sm" disabled={!cardCode.trim() || redeeming} onClick={redeem}>
                {redeeming ? '充值中…' : '充值'}
              </Button>
            </div>
          </Field>
          <p className="text-xs text-gray-500">
            卡密由客服或销售渠道提供，充值后时长充入当前账号。
          </p>
        </div>
      </SettingsCard>

      <SettingsCard Icon={Clock3} title="登录状态">
        <Field label="退出登录" note="退出后需要重新输入账号密码">
          <Button variant="outline" size="sm" onClick={() => window.api.authLogout()}>
            <LogOut className="h-4 w-4" />
            退出登录
          </Button>
        </Field>
      </SettingsCard>
    </>
  )
}
