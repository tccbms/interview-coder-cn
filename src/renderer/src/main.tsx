import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import RegionPicker from './region-picker'
import { useSettingsStore } from './lib/store/settings'
import { applyTheme } from './lib/theme'

// Paint before the first render: zustand rehydrates from localStorage
// synchronously, so the persisted theme is available here (no dark flash).
applyTheme(useSettingsStore.getState().theme)

// Open in the mode the app was left in. The main window loads without a hash;
// the toolbar and the region pickers load their own routes and are left alone
if (!window.location.hash || window.location.hash === '#/') {
  const { lastMode } = useSettingsStore.getState()
  if (lastMode === 'conversation') window.location.hash = '#/conversation'
}

// The capture-region picker is a throwaway window per screen: it must not run
// App's settings sync or shortcut registration, so it skips App altogether
// Accept both `#/region-picker` (dev loadURL / canonical) and `#region-picker`
// (what `loadFile({hash})` would produce without a leading slash), so a picker
// window never falls through to rendering the full app.
const isRegionPicker = /^#\/?region-picker$/.test(window.location.hash)

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isRegionPicker ? <RegionPicker /> : <App />}</StrictMode>
)
