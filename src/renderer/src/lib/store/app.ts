import { create } from 'zustand'
import type { AvailableUpdate } from '../../../../shared/update'
import type { BillingState } from '../../../../shared/billing'

interface AppState {
  ignoreMouse: boolean
  /** 对话模式's page is on screen; the toolbar window shows that mode's buttons */
  inConversationPage: boolean
}

interface AppStore extends AppState {
  /** A newer release main found; the header and the help page show it */
  update: AvailableUpdate | null
  setUpdate: (update: AvailableUpdate | null) => void
  /** Where the check API says to get the newest build; the help page links to it */
  downloadUrl: string | null
  setDownloadUrl: (url: string | null) => void
  setIgnoreMouse: (ignore: boolean) => void
  toggleIgnoreMouse: () => void
  /** Adopt what main reports; it sends its whole state, of which these are the fields used here */
  syncAppState: (state: AppState) => void
  /** 计时计费运行时状态，由主进程广播同步（不持久化） */
  billing: BillingState
  setBilling: (billing: BillingState) => void
  /** 余额用完的请求序号；变化时页面停止功能并跳到个人中心 */
  rechargeRequiredAt: number
  requireRecharge: () => void
}

const defaultState: AppState = {
  ignoreMouse: false,
  inConversationPage: false
}

const defaultBilling: BillingState = {
  sessionActive: false,
  remainingSeconds: 0,
  exhausted: false,
  sessionSeconds: 0,
  lastBilledSeconds: 0
}

export const useAppStore = create<AppStore>()((set) => ({
  ...defaultState,
  update: null,
  setUpdate: (update) => {
    set({ update })
  },
  downloadUrl: null,
  setDownloadUrl: (downloadUrl) => {
    set({ downloadUrl })
  },
  setIgnoreMouse: (ignore) => {
    set({ ignoreMouse: ignore })
  },
  toggleIgnoreMouse: () => {
    set((state) => ({ ignoreMouse: !state.ignoreMouse }))
  },
  syncAppState: (state) => {
    set({ ignoreMouse: state.ignoreMouse, inConversationPage: state.inConversationPage })
  },
  billing: defaultBilling,
  setBilling: (billing) => {
    set({ billing })
  },
  rechargeRequiredAt: 0,
  requireRecharge: () => {
    set({ rechargeRequiredAt: Date.now() })
  }
}))
