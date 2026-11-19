import { useEffect, useState } from 'react'
import { Camera, Clock, HelpCircle, MessagesSquare, SettingsIcon, X } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/lib/store/app'
import { useSettingsStore, type AppMode } from '@/lib/store/settings'
import { useSolutionStore } from '@/lib/store/solution'
import { formatDuration, formatRemainingSeconds } from '@/lib/utils/duration'
import { useElapsed } from '@/lib/use-elapsed'
import { MODE_NAMES, MODE_PATHS } from '@/lib/use-mode-page'

const TITLES: Record<AppMode, string> = {
  screenshot: '截屏解题',
  conversation: '对话提示'
}

export function AppHeader({ mode }: { mode: AppMode }) {
  const navigate = useNavigate()
  const { ignoreMouse, update, billing } = useAppStore()
  // A shortcut or a toolbar hover can switch either unnoticed, so both stay in view
  const model = useSettingsStore((state) => {
    const id = mode === 'screenshot' ? state.screenshotProfileId : state.conversationProfileId
    return state.apiProfiles.find((p) => p.id === id)?.model
  })
  const sceneName = useSettingsStore((state) => {
    const id = mode === 'screenshot' ? state.activeSceneId : state.conversationSceneId
    return state.scenes.find((s) => s.id === id)?.name
  })
  const context = [sceneName, model].filter(Boolean).join(' · ')
  const elapsed = useElapsed()
  const setDurationMs = useSolutionStore((state) => state.setDurationMs)
  const [appVersion, setAppVersion] = useState('')
  // 剩余不足 10 分钟：顶栏左上角用绿色徽标提醒充值
  const lowBalance = billing.exhausted || billing.remainingSeconds <= 600

  useEffect(() => {
    window.api.getAppVersion().then(setAppVersion)
  }, [])

  useEffect(() => {
    // Main measures the request and reports once, so nothing ticks here
    window.api.onSolutionDuration((ms) => setDurationMs(ms))
    return () => {
      window.api.removeSolutionDurationListener()
    }
  }, [setDurationMs])

  return (
    <div id="app-header" className="flex items-center gap-1">
      {/*
        Flex shrink decides what survives a narrow window. The higher the
        factor, the sooner that item is squeezed, and it disappears once it
        reaches `min-width: 0`:
          title    flex: 1 8 auto  compressed first, being the least informative
          context  flex: 0 4 auto  next (scene · model); still in the settings page
          timer    shrink-0        never compressed — it exists nowhere else
      */}
      {mode === 'screenshot' && elapsed !== null && (
        <span className="shrink-0 whitespace-nowrap pl-2 text-xs tabular-nums opacity-70 pointer-events-none">
          {formatDuration(elapsed)}
        </span>
      )}
      {/* 剩余时长：两种模式都展示；余额低于 10 分钟或耗尽时用绿色徽标提醒，点击跳转个人中心充值 */}
      <button
        type="button"
        title="剩余时长，点击前往充值"
        className={cn(
          'shrink-0 flex items-center gap-1 whitespace-nowrap text-xs tabular-nums pointer-events-auto [-webkit-app-region:no-drag]',
          lowBalance
            ? 'ml-6 rounded bg-emerald-600 px-2 py-0.5 font-medium text-white hover:bg-emerald-500'
            : 'pl-2 opacity-70 hover:opacity-100'
        )}
        onClick={() => navigate('/settings?tab=account')}
      >
        <Clock className="size-3" />
        {lowBalance
          ? `剩余时长 ${formatRemainingSeconds(billing.remainingSeconds)} 请充值`
          : formatRemainingSeconds(billing.remainingSeconds)}
      </button>
      <div
        className="flex min-w-0 items-baseline justify-center gap-1.5 px-2"
        style={{ flex: '1 8 auto', minWidth: 0 }}
      >
        <span className="truncate">{TITLES[mode]}</span>
        {appVersion && <span className="shrink-0 text-[10px] opacity-60">v{appVersion}</span>}
        {update && (
          // Details and the download are on the help page
          <button
            className="shrink-0 cursor-pointer rounded-sm bg-emerald-600 px-1 text-[10px] leading-4 text-white [-webkit-app-region:no-drag] hover:bg-emerald-500"
            onClick={() => navigate('/help')}
          >
            有新版本
          </button>
        )}
      </div>
      {context && (
        <span
          className="min-w-0 truncate pr-2 text-[10px] opacity-60 pointer-events-none"
          style={{ flex: '0 4 auto', minWidth: 0 }}
        >
          {context}
        </span>
      )}
      <div className={`actions flex items-center ${ignoreMouse ? 'pointer-events-none' : ''}`}>
        <ModeSwitch mode={mode} onSwitch={(next) => navigate(MODE_PATHS[next])} />
        <Button
          variant="ghost"
          className="size-8 cursor-pointer hover:opacity-50"
          onClick={() => navigate(`/settings?tab=${mode}`)}
        >
          <SettingsIcon />
        </Button>
        <Button
          variant="ghost"
          className="size-8 cursor-pointer hover:opacity-50"
          onClick={() => navigate('/help')}
        >
          <HelpCircle />
        </Button>
        <Button
          variant="ghost"
          className="size-8 cursor-pointer hover:opacity-50 hover:text-red-500"
          onClick={() => window.close()}
        >
          <X />
        </Button>
      </div>
    </div>
  )
}

/** Two icon buttons, the current mode lit; no `title`, which would draw outside content protection */
function ModeSwitch({ mode, onSwitch }: { mode: AppMode; onSwitch: (mode: AppMode) => void }) {
  const items: { value: AppMode; Icon: typeof Camera }[] = [
    { value: 'screenshot', Icon: Camera },
    { value: 'conversation', Icon: MessagesSquare }
  ]
  return (
    <div className="mr-1 flex items-center rounded-md bg-app-chip p-0.5" aria-label="切换模式">
      {items.map(({ value, Icon }) => (
        <button
          key={value}
          aria-label={MODE_NAMES[value]}
          className={cn(
            'flex h-6 items-center gap-1 rounded px-1.5 text-[11px] transition-colors',
            value === mode
              ? 'bg-[var(--app-hover-bg)]'
              : 'opacity-60 hover:opacity-100 cursor-pointer'
          )}
          onClick={() => value !== mode && onSwitch(value)}
        >
          <Icon className="size-3.5" />
          <span className="max-[520px]:hidden">{value === 'screenshot' ? '截图' : '对话'}</span>
        </button>
      ))}
    </div>
  )
}
