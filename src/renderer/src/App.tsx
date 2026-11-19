import { useCallback, useEffect, useRef, useState } from 'react'
import { HashRouter, Routes, Route, useLocation, useNavigate } from 'react-router'
import { Toaster, toast } from 'sonner'
import CoderPage from '@/coder'
import ConversationPage from '@/conversation'
import SettingsPage from '@/settings'
import HelpPage from '@/help'
import LoginPage from '@/auth'
import { OverlayToolbar } from '@/coder/OverlayToolbar'
import { useSettingsStore } from '@/lib/store/settings'
import { useShortcutsStore } from '@/lib/store/shortcuts'
import { useAppStore } from '@/lib/store/app'
import { useTranscriptionStore } from '@/lib/store/transcription'
import { stopListening } from '@/conversation/listening'
import { getCloneableFields } from '@/lib/utils'
import { applyTheme } from '@/lib/theme'
import { WindowResizeHandles } from '@/components/WindowResizeHandles'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { MODE_PATHS } from '@/lib/use-mode-page'

export default function App() {
  const [initialized, setInitialized] = useState(false)
  const settingsStore = useSettingsStore()
  const { shortcuts } = useShortcutsStore()
  const theme = useSettingsStore((state) => state.theme)

  // Paint the window before syncing with main, so the first frame already uses
  // the persisted theme; the toolbar window gets the live value pushed to it.
  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    Promise.all([window.api.getAppSettings(), window.api.getRemoteConfig()]).then(
      ([settings, remoteConfig]) => {
        const blankFields = Object.keys(settings).filter(
          (key) => settings[key] && !settingsStore[key]
        )
        settingsStore.syncSettings(
          blankFields.reduce(
            (acc, key) => {
              acc[key] = settings[key]
              return acc
            },
            {} as Partial<typeof settingsStore>
          )
        )
        // The check API's endpoints and keys win over whatever was saved
        // locally; they go in after the sync above so it cannot undo them
        if (remoteConfig) {
          useSettingsStore.getState().applyRemoteConfig(remoteConfig)
          useAppStore.getState().setDownloadUrl(remoteConfig.downloadUrl || null)
          useAppStore.getState().setRechargeUrl(remoteConfig.rechargeUrl || null)
        }
        setInitialized(true)
      }
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reaching the app through the login page fetches the configuration
  // after the window is up, and main pushes it then
  useEffect(() => {
    window.api.onRemoteConfig((remoteConfig) => {
      useSettingsStore.getState().applyRemoteConfig(remoteConfig)
      useAppStore.getState().setDownloadUrl(remoteConfig.downloadUrl || null)
      useAppStore.getState().setRechargeUrl(remoteConfig.rechargeUrl || null)
    })
    return () => window.api.removeRemoteConfigListener()
  }, [])

  useEffect(() => {
    if (initialized) {
      window.api.updateAppSettings(getCloneableFields(settingsStore))
    }
  }, [initialized, settingsStore])

  // A region picked from the settings page, the toolbar or the shortcut: main
  // applies it at once, the store persists it. Only the main window is told
  useEffect(() => {
    window.api.onCaptureRegionPicked((region) => {
      useSettingsStore.getState().updateSetting('captureRegion', region)
      toast('截图区域已更新，之后只截这块区域')
    })
    return () => window.api.removeCaptureRegionPickedListener()
  }, [])

  // A screenshot was refused for want of image input: remember that about the
  // profile, so 截图模式 no longer offers it. Only an unknown flag is overwritten;
  // the platform's own model list is the better witness
  useEffect(() => {
    window.api.onVisionUnsupported((profileId) => {
      const store = useSettingsStore.getState()
      const profile = store.apiProfiles.find((p) => p.id === profileId)
      if (profile && profile.vision === undefined) store.updateProfile(profileId, { vision: false })
    })
    return () => window.api.removeVisionUnsupportedListener()
  }, [])

  // A newer release, as main finds it: at startup and every few hours after
  useEffect(() => {
    const { setUpdate } = useAppStore.getState()
    window.api.getUpdateStatus().then(setUpdate)
    window.api.onUpdateStatus(setUpdate)
    return () => window.api.removeUpdateStatusListener()
  }, [])

  // 计时计费：主进程广播会话状态与一次性提示，渲染层同步到 store
  useEffect(() => {
    const { setBilling } = useAppStore.getState()
    window.api.getBillingState().then(setBilling)
    // 主动拉一次最新余额：登出重置后重新登录、或网页充值后重进主窗口，
    // 确保顶栏展示与本地门禁状态为当前用户的真实值（无 token 时 main 侧 no-op）
    void window.api.refreshBilling()
    window.api.onBillingUpdate(setBilling)
    window.api.onBillingNotice((notice) => {
      if (notice.kind === 'error') toast.error(notice.message)
      else if (notice.kind === 'warn') toast.warning(notice.message)
      else toast(notice.message)
    })
    // 余额用完：停止功能并跳到个人中心充值（在路由内的控制器里执行）
    window.api.onBillingRechargeRequired(() => useAppStore.getState().requireRecharge())
    return () => {
      window.api.removeBillingUpdateListener()
      window.api.removeBillingNoticeListener()
      window.api.removeBillingRechargeRequiredListener()
    }
  }, [])

  useEffect(() => {
    // 登录页不注册全局快捷键：登录期间无需快捷键，且避免干扰其他应用。
    // 用 window.location.hash 判断，不能调 useLocation()——App 组件创建 <HashRouter>，
    // 自身在 Router context 之外，调用 useLocation 会抛错导致白屏。
    if (window.location.hash === '#/login') return
    window.api.initShortcuts(shortcuts)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <HashRouter>
        <ToolbarVisibilityController />
        <WindowResizeController />
        <BillingRechargeController />
        <Routes>
          <Route index element={<CoderPage />} />
          <Route path="conversation" element={<ConversationPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="help" element={<HelpPage />} />
          <Route path="login" element={<LoginPage />} />
          <Route path="toolbar" element={<OverlayToolbar />} />
        </Routes>
      </HashRouter>

      <Toaster />
    </>
  )
}

/** The toolbar window renders its own handles; this covers the main window's routes */
function WindowResizeController() {
  const location = useLocation()
  const resizable = useSettingsStore((state) => state.resizable)

  if (location.pathname === '/toolbar') return null
  return <WindowResizeHandles enabled={resizable} />
}

function ToolbarVisibilityController() {
  const location = useLocation()
  const showOverlayToolbar = useSettingsStore((state) => state.showOverlayToolbar)

  useEffect(() => {
    // The toolbar window renders this app too, but must not drive its own visibility
    if (location.pathname === '/toolbar') return
    const onModePage = Object.values(MODE_PATHS).includes(location.pathname)
    void window.api.setToolbarVisible(onModePage && showOverlayToolbar)
  }, [location.pathname, showOverlayToolbar])

  return null
}

/**
 * 余额用完：停止正在进行的生成 / 语音识别，弹窗提示并跳到个人中心充值。
 * 必须在 <HashRouter> 内才能 useNavigate。
 */
function BillingRechargeController() {
  const navigate = useNavigate()
  const location = useLocation()
  const rechargeRequiredAt = useAppStore((state) => state.rechargeRequiredAt)
  const exhausted = useAppStore((state) => state.billing.exhausted)
  const [open, setOpen] = useState(false)
  const wasExhausted = useRef(false)

  const showRecharge = useCallback(() => {
    if (location.pathname === '/toolbar' || location.pathname === '/login') return
    // 正在生成答案 / 识别语音：立即停止，避免继续消耗
    window.api.stopSolutionStream()
    if (useTranscriptionStore.getState().isTranscribing) void stopListening()
    setOpen(true)
  }, [location.pathname])

  const goRecharge = useCallback(() => {
    setOpen(false)
    navigate('/settings?tab=account')
  }, [navigate])

  // 主动拦截（截图 / 追问 / 提示被门禁挡下）时立即提示
  useEffect(() => {
    if (!rechargeRequiredAt) return
    showRecharge()
    // 只在余额用完时触发一次，路由变化不应重复触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rechargeRequiredAt])

  // 余额在后台变为 0（本地倒计时 / 心跳）时也要弹窗，不只依赖主动操作
  useEffect(() => {
    if (exhausted && !wasExhausted.current) showRecharge()
    wasExhausted.current = exhausted
    if (!exhausted) setOpen(false)
  }, [exhausted, showRecharge])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>余额不足，请充值</DialogTitle>
          <DialogDescription>剩余时长已用完，请充值后继续使用截图解题与对话提示。</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            稍后再说
          </Button>
          <Button onClick={goRecharge}>去充值</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
