import { useEffect, useState } from 'react'

/**
 * 激活页：独立全屏页面，不含任何主界面功能入口。
 *
 * 不 import shared/activation（vite renderer 无 @shared alias），类型内联。
 * window.api 的类型由 preload 推导（preload 正常 import shared）。
 */

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

/** 钥匙图标，激活主题 */
function KeyIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 2.5a6 6 0 0 0-5.66 8.04l-3.82 3.82a1 1 0 0 0-.29.7v3.44a1 1 0 0 0 1 1h2.5a1 1 0 0 0 1-1v-1h1a1 1 0 0 0 1-1v-1h1.4A6 6 0 1 0 12 2.5Zm2.25 5.25a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5Z"
        fill="currentColor"
      />
    </svg>
  )
}

export default function ActivationPage() {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [reasonPayload, setReasonPayload] = useState<ActivationReasonPayload | null>(null)

  useEffect(() => {
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
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#0a0a0a] via-[#0f0f12] to-[#0a0a0a] px-6 py-10 text-[#fafafa]">
      <div className="w-full max-w-md space-y-7">
        <header className="flex flex-col items-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/25">
            <KeyIcon className="h-9 w-9 text-white" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">激活应用</h1>
          <p className="mt-2 text-sm text-[#a1a1aa]">请输入激活码完成激活后使用</p>
        </header>

        {(showExpiredHint || showNetworkHint) && (
          <div
            className={`rounded-lg border px-4 py-3 text-sm ${
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
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="space-y-2">
          <label htmlFor="activation-code" className="text-sm font-medium text-[#d4d4d8]">
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
            className="w-full rounded-lg border border-[#27272a] bg-[#18181b] px-4 py-2.5 text-sm outline-none transition focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50"
          />
        </div>

        <button
          type="button"
          onClick={handleActivate}
          disabled={loading || !code.trim()}
          className="w-full rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-blue-500/20 transition hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
        >
          {loading ? '激活中…' : '激活'}
        </button>

        <p className="text-center text-xs text-[#71717a]">按 Ctrl/Cmd + Enter 快速提交</p>
      </div>
    </div>
  )
}
