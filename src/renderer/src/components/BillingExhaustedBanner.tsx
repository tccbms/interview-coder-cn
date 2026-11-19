import { useNavigate } from 'react-router'
import { AlertTriangle } from 'lucide-react'
import { useAppStore } from '@/lib/store/app'

/**
 * 余额耗尽时在内容区顶部显示的充值引导横幅。
 * 截图模式与对话模式共用，由主进程的 billing.exhausted 驱动。
 */
export function BillingExhaustedBanner() {
  const navigate = useNavigate()
  const exhausted = useAppStore((state) => state.billing.exhausted)
  if (!exhausted) return null
  return (
    <div className="mb-4 flex items-center gap-3 rounded-lg border border-red-500/50 bg-red-500/20 p-3">
      <AlertTriangle className="size-5 flex-shrink-0 text-red-400" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-red-300">剩余时长已用完</p>
        <p className="mt-0.5 text-xs text-red-300/80">请充值后继续使用截图解题与对话提示</p>
      </div>
      <button
        type="button"
        className="flex-shrink-0 rounded bg-red-600 px-3 py-1 text-xs text-white hover:bg-red-500"
        onClick={() => navigate('/settings?tab=account')}
      >
        去充值
      </button>
    </div>
  )
}
