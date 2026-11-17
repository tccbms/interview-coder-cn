import { useEffect, useState } from 'react'

/**
 * 登录页：独立全屏页面，不含任何主界面功能入口。
 *
 * 不 import shared/auth（vite renderer 无 @shared alias），类型内联。
 * window.api 的类型由 preload 推导（preload 正常 import shared）。
 */

interface LoginReasonPayload {
  reason: 'none' | 'unauthorized' | 'network'
  message: string
}
interface AuthResult {
  ok: boolean
  message: string
  data?: unknown
}

/** 用户图标，登录主题 */
function UserIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 2.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11ZM3.5 20.5a8.5 8.5 0 0 1 17 0 1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1Z"
        fill="currentColor"
      />
    </svg>
  )
}

export default function LoginPage() {
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [reasonPayload, setReasonPayload] = useState<LoginReasonPayload | null>(null)

  useEffect(() => {
    document.title = '胖猫面试助手'
    window.api.authGetReason().then((payload) => {
      if (payload) setReasonPayload(payload)
    })
    window.api.onAuthReason((payload) => setReasonPayload(payload))
    return () => window.api.removeAuthReasonListener()
  }, [])

  async function handleLogin() {
    if (loading || !account.trim() || !password) return
    setLoading(true)
    setError('')
    try {
      const result: AuthResult = await window.api.authLogin(account.trim(), password)
      if (!result.ok) {
        setError(result.message || '登录失败')
        setLoading(false)
      }
      // 成功后主进程会关闭本窗口进入主界面，无需再操作
    } catch {
      setError('登录请求异常')
      setLoading(false)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    void handleLogin()
  }

  const showUnauthorizedHint = reasonPayload?.reason === 'unauthorized'
  const showNetworkHint = reasonPayload?.reason === 'network'

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#0a0a0a] px-6 py-8 text-[#fafafa]">
      <form className="flex w-full flex-col" onSubmit={handleSubmit}>
        <header className="flex flex-col items-center text-center">
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/40">
            <UserIcon className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">胖猫面试助手</h1>
          <p className="mt-2 text-sm text-[#a1a1aa]">请使用账号密码登录后使用</p>
        </header>

        {(showUnauthorizedHint || showNetworkHint) && (
          <div
            className={`mt-7 rounded-lg border px-4 py-3 text-sm ${
              showUnauthorizedHint
                ? 'border-red-500/30 bg-red-500/10 text-red-400'
                : 'border-yellow-500/30 bg-yellow-500/10 text-yellow-400'
            }`}
          >
            <div className="font-medium">
              {showUnauthorizedHint ? '登录已失效，请重新登录' : '网络异常，请检查网络后重试'}
            </div>
            {reasonPayload?.message && (
              <div className="mt-1 text-xs opacity-80">{reasonPayload.message}</div>
            )}
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="mt-7 space-y-4">
          <div className="space-y-2">
            <label htmlFor="login-account" className="block text-sm font-medium text-[#d4d4d8]">
              账号
            </label>
            <input
              id="login-account"
              type="text"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder="请输入账号"
              disabled={loading}
              autoComplete="username"
              spellCheck={false}
              autoFocus
              className="w-full rounded-lg border border-[#27272a] bg-[#18181b] px-4 py-2.5 text-sm outline-none transition focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="login-password" className="block text-sm font-medium text-[#d4d4d8]">
              密码
            </label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              disabled={loading}
              autoComplete="current-password"
              className="w-full rounded-lg border border-[#27272a] bg-[#18181b] px-4 py-2.5 text-sm outline-none transition focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || !account.trim() || !password}
          className="mt-6 w-full rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-blue-500/30 transition hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
        >
          {loading ? '登录中…' : '登录'}
        </button>

        <p className="mt-4 text-center text-xs text-[#71717a]">按 Enter 快速登录</p>
      </form>
    </div>
  )
}
