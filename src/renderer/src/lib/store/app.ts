import { create } from 'zustand'
import type { AvailableUpdate } from '../../../../shared/update'
import type { AppMode } from '../../../../shared/api-profile'
import type { BillingState } from '../../../../shared/billing'

interface AppState {
  ignoreMouse: boolean
  /** 对话模式's page is on screen; the toolbar window shows that mode's buttons */
  inConversationPage: boolean
  /** The mode speech recognition is running for, or null; the toolbar's microphone shows it */
  listening: AppMode | null
  /** Recognition last ended on an error rather than being stopped */
  listenFailed: boolean
}

interface AppStore extends AppState {
  /** A newer release main found; the header and the help page show it */
  update: AvailableUpdate | null
  setUpdate: (update: AvailableUpdate | null) => void
  setIgnoreMouse: (ignore: boolean) => void
  toggleIgnoreMouse: () => void
  /** Adopt what main reports; it sends its whole state, of which these are the fields used here */
  syncAppState: (state: AppState) => void
  /** Where the check API says to get the newest build; the help page links to it */
  downloadUrl: string | null
  setDownloadUrl: (url: string | null) => void
  /** Where the check API says to recharge; 个人中心's 充值联系 button links to it */
  rechargeUrl: string | null
  setRechargeUrl: (url: string | null) => void
  /** 计时计费运行时状态，由主进程广播同步（不持久化） */
  billing: BillingState
  setBilling: (billing: BillingState) => void
  /** 余额用完的请求序号；变化时页面停止功能并跳到个人中心 */
  rechargeRequiredAt: number
  requireRecharge: () => void
}

const defaultState: AppState = {
  ignoreMouse: false,
  inConversationPage: false,
  listening: null,
  listenFailed: false
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
  setIgnoreMouse: (ignore) => {
    set({ ignoreMouse: ignore })
  },
  toggleIgnoreMouse: () => {
    set((state) => ({ ignoreMouse: !state.ignoreMouse }))
  },
  syncAppState: (state) => {
    set({
      ignoreMouse: state.ignoreMouse,
      inConversationPage: state.inConversationPage,
      listening: state.listening,
      listenFailed: state.listenFailed
    })
  },
  downloadUrl: null,
  setDownloadUrl: (downloadUrl) => {
    set({ downloadUrl })
  },
  rechargeUrl: null,
  setRechargeUrl: (rechargeUrl) => {
    set({ rechargeUrl })
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
