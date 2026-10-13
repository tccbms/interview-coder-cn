import { useEffect, useState } from 'react'

/**
 * 激活页：独立全屏页面，不含任何主界面功能入口。
 *
 * 注意：此文件不 import shared/activation，因为 vite renderer 配置
 * 没有 @shared alias 且跳出 root 的相对路径会失败。所需类型与函数在此内联。
 * window.api 的类型由 preload 推导（preload 正常 import shared）。
 */

// 与 shared/activation.ts 的类型结构保持一致
interface ActivationReasonPayload {
  reason: 'expired' | 'network'
  message: string
  previouslyActivated: boolean
}
interface ActivationResult {
  ok: boolean
  message: string
  data?: unknown
}

/** 把 deviceId 脱敏成「前 8 位 + …」用于展示 */
function maskDeviceId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id
}

export default function ActivationPage() {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [deviceId, setDeviceId] = useState('')
  const [copied, setCopied] = useState(false)
  const [reasonPayload, setReasonPayload] = useState<ActivationReasonPayload | null>(null)

  useEffect(() => {
    window.api.activationGetDeviceId().then(setDeviceId)
    window.api.activationGetReason().then((payload) => {
      if (payload) setReasonPayload(payload)
    })
    window.api.onActivationReason((payload) => setReasonPayload(payload))
    return () => window.api.removeActivationReasonListener()
  }, [])

  async function handleActivate() {
    if (loading || !code.trim()) return
    setLoading(true)
    setError('')
    try {
      const result: ActivationResult = await window.api.activationActivate(code)
      if (!result.ok) {
        setError(result.message || '激活失败')
      }
    } catch {
      setError('激活请求异常')
    } finally {
      setLoading(false)
    }
  }

  async function handleCopyDeviceId() {
    if (!deviceId) return
    try {
      await navigator.clipboard.writeText(deviceId)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setError('复制失败，请手动选择设备 ID 复制')
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      void handleActivate()
    }
  }

  const showExpiredHint =
    reasonPayload?.reason === 'expired' && reasonPayload.previouslyActivated
  const showNetworkHint = reasonPayload?.reason === 'network'

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#0a0a0a] px-6 py-10 text-[#fafafa]">
      <div className="w-full max-w-md space-y-6">
        <header className="text-center">
          <h1 className="text-2xl font-semibold">激活应用</h1>
          <p className="mt-2 text-sm text-[#a1a1aa]">请输入激活码完成激活后使用</p>
        </header>

        {(showExpiredHint || showNetworkHint) && (
          <div
            className={`rounded-md border px-4 py-3 text-sm ${
              showExpiredHint
                ? 'border-red-500/30 bg-red-500/10 text-red-400'
                : 'border-yellow-500/30 bg-yellow-500/10 text-yellow-400'
            }`}
          >
            <div className="font-medium">
              {showExpiredHint ? '授权已失效，请重新激活' : '网络异常，请检查网络后重试'}
            </div>
            {reasonPayload?.message && (
              <div className="mt-1 text-xs opacity-80">{reasonPayload.message}</div>
            )}
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="space-y-2">
          <label htmlFor="activation-code" className="text-sm font-medium">
            激活码
          </label>
          <input
            id="activation-code"
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="请输入或粘贴激活码"
            disabled={loading}
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-md border border-[#27272a] bg-[#0a0a0a] px-3 py-2 text-sm outline-none focus:border-[#3f3f46] disabled:opacity-50"
          />
        </div>

        <button
          type="button"
          onClick={handleActivate}
          disabled={loading || !code.trim()}
          className="w-full rounded-md bg-[#3b82f6] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? '激活中…' : '激活'}
        </button>

        <div className="rounded-md border border-[#27272a] bg-[#18181b] px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs text-[#a1a1aa]">当前设备 ID</div>
              <div className="mt-1 truncate font-mono text-sm">
                {deviceId ? maskDeviceId(deviceId) : '获取中…'}
              </div>
            </div>
            <button
              type="button"
              onClick={handleCopyDeviceId}
              disabled={!deviceId}
              className="shrink-0 rounded-md border border-[#27272a] px-3 py-1.5 text-xs transition hover:bg-[#27272a] disabled:opacity-50"
            >
              {copied ? '已复制' : '复制设备 ID'}
            </button>
          </div>
          <p className="mt-2 text-xs text-[#a1a1aa]">
            如需获取激活码，请复制设备 ID 后联系客服。
          </p>
        </div>

        <p className="text-center text-xs text-[#a1a1aa]">按 Ctrl/Cmd + Enter 快速提交</p>
      </div>
    </div>
  )
}
