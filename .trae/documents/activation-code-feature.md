# 激活码激活 + 启动校验功能 实现方案

## Context

为 interview-coder-cn 桌面应用新增授权管控：用户拿到激活码后在客户端输入完成激活；激活成功后每次启动自动向服务端校验授权是否仍有效，失效则回到激活页。本地缓存仅用于避免冷启动白屏，绝不替代服务端校验。基址 `http://oa.feilong520.top`，RuoYi AjaxResult 响应 `{code:int, msg:string, data?:object}`，`code==0` 为唯一成功依据。

---

## 先回答用户提出的 5 个问题

### Q1：deviceId 和激活状态存哪里？

存在磁盘 `app.getPath('userData')/activation.json`，字段 `{ deviceId: string, activated: boolean, lastCheckedAt?: number }`。

理由与现有模式对齐：
- 项目**没有**用 `safeStorage` 或 `electron-store`（已 grep 确认无匹配）。
- 现有持久化范式是 `app.getPath('userData')` + `fs/promises` 原子写（写 `.tmp` 再 `rename`），见 [knowledge.ts](file:///Users/hetaiyi/Desktop/my/tech/web/interview-coder-cn/src/main/knowledge.ts#L30-L72) 的 `storeDir()` / `writeAtomic()`。激活状态复用同一套写法。
- deviceId 本身已做哈希脱敏（要求明确），无需 safeStorage 加密；明文存配置文件即可。
- 不放进 renderer 的 Zustand localStorage：deviceId 必须在主进程启动早期、窗口创建前就读到，不能依赖渲染层同步。

### Q2：校验接口放在启动流程的哪个位置？如何避免主界面「闪一下」？

放在 `app.whenReady()` 内、`createWindow()` 调用之前。流程：

1. `app.whenReady()` → 读/生成 deviceId → 调 `/api/code/check`（10s 超时）
2. `code == 0` → 调 `createWindow()` 创建主窗口；主窗口初始 `show: false`，在 `ready-to-show` 事件里才 `show()`（[main-window.ts:60](file:///Users/hetaiyi/Desktop/my/tech/web/interview-coder-cn/src/main/main-window.ts#L60)），所以校验通过期间用户什么都看不到。
3. `code != 0` 或网络失败 → **不创建主窗口**，直接创建激活窗口（`show: true` 或 `ready-to-show` show）。

关键：主窗口从头到尾不创建/不显示，就没有闪屏。校验期间是黑屏（Electron 启动初期），用户感知是「应用启动稍慢一点然后直接进主界面 或 进激活页」，无闪现。

### Q3：激活页在 Electron / 当前框架下如何实现为独立页面或路由？

实现为独立 `BrowserWindow` + 独立路由 `#/activation`：

- 新建 `src/main/activation-window.ts`，创建一个**普通**窗口（非透明、非 always-on-top、`frame: true` 或自定义标题栏、禁用最大化/最小化按钮、关闭=退出应用）。加载同一个 renderer bundle，但 hash 为 `#/activation`。
- `src/renderer/src/App.tsx` 的 `<Routes>` 增加 `<Route path="activation" element={<ActivationPage />} />`。
- ActivationPage 是全屏页面，**不**渲染 `WindowResizeHandles`、`ToolbarVisibilityController` 等主界面控件（这些组件已按路由判断，见 [App.tsx:113-130](file:///Users/hetaiyi/Desktop/my/tech/web/interview-coder-cn/src/renderer/src/App.tsx#L113-L130)，激活路由天然不在 `MODE_PATHS` 里）。
- 不走 region-picker 那种「从 main.tsx 直接渲染跳过 App」的模式——激活页需要 App 的主题应用（`applyTheme`）来保证深浅色一致，且 App 的 settings sync 即便跑了也无害（激活态不依赖 settings）。

### Q4：代码组织（目录、模块、是否封装统一 HTTP 请求方法）？

**新增文件：**

| 文件 | 作用 |
|------|------|
| `src/shared/activation.ts` | 共享类型与常量：`DEVICE_TYPE = 3`、`ActivationResult`（`{ ok: boolean; message: string; data?: unknown }`）、`ActivationStatus`（持久化结构）、`cleanActivationCode()`（去首尾空格 + 全角转半角） |
| `src/main/activation-http.ts` | 封装统一请求方法 `postActivationAPI(path, body)`：10s 超时、HTTP 非 2xx、JSON 解析失败、`code != 0` 全部转成 `{ ok: false, message }`；成功返回 `{ ok: true, message: msg, data }`。日志打印 deviceId 做脱敏（只显示前 8 位 + …） |
| `src/main/activation-device.ts` | `getDeviceId()`：优先硬件指纹（mac: `system_profiler SPHardwareDataType` 取 Serial/UUID；win: `wmic`/PowerShell 取主板序列号 + CPU；失败降级 `os.networkInterfaces()` MAC 地址），SHA256 哈希后转字符串；全部取不到才降级 `randomUUID()`。读写 `activation.json` |
| `src/main/activation.ts` | 启动校验编排 `runStartupCheck()`（读 deviceId → 调 check → 返回通过/不通过 + 提示文案）、激活窗口生命周期管理、IPC handler（`activation:check`、`activation:activate`、`activation:get-device-id`、`activation:quit`） |
| `src/main/activation-window.ts` | `createActivationWindow(reason, subTitle)`：创建激活窗口、加载 `#/activation`、关闭=退出 |
| `src/renderer/src/activation/index.tsx` | ActivationPage：输入框（支持粘贴）、激活按钮（防重复提交：`useState` loading 置灰）、错误提示区、设备 ID 展示 + 复制按钮、顶部失效提示（若 `reason == 'expired'` 显示「授权已失效，请重新激活」+ 服务端 msg 副标题；若 `reason == 'network'` 显示「网络异常，请检查网络后重试」） |

**修改文件：**

| 文件 | 修改内容 |
|------|---------|
| [src/main/index.ts](file:///Users/hetaiyi/Desktop/my/tech/web/interview-coder-cn/src/main/index.ts) | `app.whenReady()` 内：在 `createWindow()` 前插入 `await runStartupCheck()`；通过→`createWindow()`+`initAutoUpdater()`；不通过→`createActivationWindow(reason, msg)`。移除原来无条件 `createWindow()` 的调用 |
| [src/main/index.d.ts](file:///Users/hetaiyi/Desktop/my/tech/web/interview-coder-cn/src/main/index.d.ts) | 增加 `declare global { var activationWindow: BrowserWindow \| null }` |
| [src/preload/index.ts](file:///Users/hetaiyi/Desktop/my/tech/web/interview-coder-cn/src/preload/index.ts) | 暴露 `activationCheck()`、`activationActivate(code)`、`activationGetDeviceId()`、`activationQuit()`；事件 `onActivationEnterMain`（激活成功后主进程通知渲染层进入主界面） |
| [src/renderer/src/App.tsx](file:///Users/hetaiyi/Desktop/my/tech/web/interview-coder-cn/src/renderer/src/App.tsx) | `<Routes>` 加 `<Route path="activation" element={<ActivationPage />} />`；`WindowResizeController` 已按 `location.pathname === '/toolbar'` 跳过，激活路由天然不在 `MODE_PATHS` 不受影响 |
| [src/main/main-window.ts](file:///Users/hetaiyi/Desktop/my/tech/web/interview-coder-cn/src/main/main-window.ts) | 导出一个 `loadMainWindow()` 函数把 loadURL/loadFile 逻辑抽出，便于激活成功后调用；或保持 `createWindow()` 不变，激活成功时直接调用 `createWindow()`（当前实现已可复用） |

### Q5：有没有我没提到、但你认为必须处理的边界情况？

1. **macOS 关闭激活窗口默认不退出**：项目 `window-all-closed` 里 darwin 分支不 `app.quit()`（[index.ts:114-119](file:///Users/hetaiyi/Desktop/my/tech/web/interview-coder-cn/src/main/index.ts#L114-L119)）。激活窗口关闭必须强制 `app.quit()`——在激活窗口的 `closed` 事件里直接 `app.quit()`，绕过 darwin 的「留后台」逻辑。
2. **主窗口不存在期间的 IPC 防御**：`shortcuts.ts` 等模块在 `app.whenReady` 后通过 import 副作用注册 handler，里面引用 `global.mainWindow` 时已有 `&&` 短路保护（见 [index.ts:105](file:///Users/hetaiyi/Desktop/my/tech/web/interview-coder-cn/src/main/index.ts#L105) 的写法）。激活期间主窗口不存在，但要确保 `triggerAction` 等不会崩——因为全局快捷键在激活期间不应注册（见下条）。
3. **激活期间不应注册全局快捷键**：`shortcuts.ts` 的 `initShortcuts` IPC 由 renderer `App.tsx` 触发。激活窗口加载 ActivationPage 而非 App，所以不会触发 `initShortcuts`，全局快捷键天然不注册。但 ActivationPage 走 App 路由会触发 App 的 `useEffect` → `initShortcuts`。**解决**：在 App.tsx 的 initShortcuts useEffect 里判断 `location.pathname === '/activation'` 时跳过；或让 ActivationPage 完全脱离 App（参考 region-picker 模式，在 main.tsx 按 hash 单独渲染）。
4. **dev 模式 URL**：dev 下主窗口 `loadURL(process.env.ELECTRON_RENDERER_URL)`，激活窗口要 `loadURL(`${ELECTRON_RENDERER_URL}#/activation`)`；prod 下 `loadFile(index.html)` + hash 路由，需 `loadFile(join(__dirname, '../renderer/index.html'), { hash: 'activation' })`。
5. **deviceId 哈希稳定性**：硬件信息取到的字符串在不同 macOS 版本可能格式微变（如空格/大小写），哈希前先 `.trim().toLowerCase()` 规范化，保证同一机器稳定。
6. **激活成功后进主界面的过渡**：激活成功 → 主进程 `activationWindow.close()` → `createWindow()` 创建主窗口。但 `createWindow` 是 `show:false` + `ready-to-show` 才 show，期间激活窗口已关闭会出现短暂黑屏。**优化**：先 `createWindow()`，等主窗口 `ready-to-show` 后再关激活窗口（在 main 进程用一次性监听器协调）。
7. **离线宽限**：需求里说「网络失败跳激活页」严格不放行。但补充约束提到「若不需要请忽略本条」。**按严格需求实现**：网络失败一律跳激活页，不做宽限。
8. **`data` 字段空值保护**：`postActivationAPI` 解析响应时 `data` 可能不存在/为 null/对象/字符串，统一 `data ?? undefined` 透传，调用方需要时再判空。
9. **重复 IPC 请求防御**：除了激活按钮前端置灰，主进程 `activation:activate` handler 也加一个 `pending` 标志位，防止双焦点/快捷键绕过。
10. **校验期间用户强退**：校验是 `await fetch`，Electron `before-quit` 期间 fetch 会被 abort，走 `catch` 返回「校验失败」→ 创建激活窗口。但此时 app 已在退出，激活窗口来不及显示。**接受**此行为（用户主动退出，不应继续）。

---

## 实现方案

### 文件清单（新建 6 + 修改 4 = 10 个文件）

**新建：**
1. `src/shared/activation.ts` — 共享类型/常量/清洗函数
2. `src/main/activation-http.ts` — 统一 HTTP 请求封装
3. `src/main/activation-device.ts` — deviceId 生成与读取（独立模块，只暴露 `getDeviceId()`）
4. `src/main/activation.ts` — 启动校验编排 + IPC handler
5. `src/main/activation-window.ts` — 激活窗口创建
6. `src/renderer/src/activation/index.tsx` — ActivationPage 组件

**修改：**
1. `src/main/index.ts` — `app.whenReady()` 插入启动校验流程
2. `src/main/index.d.ts` — 加 `activationWindow` global 声明
3. `src/preload/index.ts` — 暴露 activation 相关 IPC
4. `src/renderer/src/App.tsx` — 加 `/activation` 路由 + initShortcuts 跳过激活页

### 关键代码骨架

**`src/shared/activation.ts`**
```ts
export const DEVICE_TYPE = 3
export const ACTIVATION_BASE_URL = 'http://oa.feilong520.top'
export interface ActivationResult {
  ok: boolean
  message: string
  data?: unknown
}
export interface ActivationStatus {
  deviceId: string
  activated: boolean
  lastCheckedAt?: number
}
/** 去首尾空格 + 全角转半角（ASCII 范围） */
export function cleanActivationCode(code: string): string {
  return code.trim().replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
}
```

**`src/main/activation-http.ts`** — 复用 [model-list.ts:44-55](file:///Users/hetaiyi/Desktop/my/tech/web/interview-coder-cn/src/main/model-list.ts#L44-L55) 的 `fetch + AbortSignal.timeout(10_000)` 模式：
```ts
export async function postActivationAPI(path: string, body: unknown): Promise<ActivationResult> {
  try {
    const res = await fetch(`${ACTIVATION_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000)
    })
    if (!res.ok) return { ok: false, message: `服务端返回 HTTP ${res.status}` }
    const json = await res.json()
    if (json?.code === 0) return { ok: true, message: json.msg ?? '操作成功', data: json.data ?? undefined }
    return { ok: false, message: json?.msg ?? '操作失败' }
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError'
    return { ok: false, message: timedOut ? '请求超时' : '网络异常，请检查网络后重试' }
  }
}
```

**`src/main/activation-device.ts`** — 复用 [knowledge.ts](file:///Users/hetaiyi/Desktop/my/tech/web/interview-coder-cn/src/main/knowledge.ts#L30-L72) 的 `userData` + `writeAtomic` 模式：
```ts
import { execSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'fs'
import { mkdirSync, rename, writeFile } from 'fs/promises'
import { join } from 'path'
import { app } from 'electron'

let cachedDeviceId: string | null = null

function readStatus(): ActivationStatus | null { /* read activation.json */ }
async function writeStatus(s: ActivationStatus): Promise<void> { /* writeAtomic */ }

function collectHardwareFingerprint(): string | null {
  try {
    if (process.platform === 'darwin') {
      const out = execSync('system_profiler SPHardwareDataType', { timeout: 5000 }).toString()
      const serial = /Serial Number.*?:\s*([^\n]+)/.exec(out)?.[1]
      const uuid = /Hardware UUID.*?:\s*([^\n]+)/.exec(out)?.[1]
      if (serial || uuid) return `${serial ?? ''}|${uuid ?? ''}`
    } else if (process.platform === 'win32') {
      const cmd = 'powershell -Command "Get-WmiObject Win32_BaseBoard | Select-Object -ExpandProperty SerialNumber; Get-WmiObject Win32_Processor | Select-Object -ExpandProperty ProcessorId"'
      const out = execSync(cmd, { timeout: 5000 }).toString().trim()
      if (out) return out
    }
  } catch { /* fall through */ }
  // 降级：MAC 地址
  // 再降级：randomUUID()
  return null
}

export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId
  const status = readStatus()
  if (status?.deviceId) { cachedDeviceId = status.deviceId; return cachedDeviceId }
  const fingerprint = collectHardwareFingerprint()
  const id = fingerprint
    ? createHash('sha256').update(fingerprint.trim().toLowerCase()).digest('hex')
    : randomUUID()
  await writeStatus({ deviceId: id, activated: false })
  cachedDeviceId = id
  console.log('[activation] deviceId generated:', id.slice(0, 8) + '…')  // 脱敏日志
  return id
}

export function maskDeviceId(id: string): string { return id.slice(0, 8) + '…' }
```

**`src/main/activation.ts`** — 启动校验编排 + IPC：
```ts
export type CheckOutcome = { ok: true } | { ok: false; reason: 'expired' | 'network'; message: string; previouslyActivated: boolean }

export async function runStartupCheck(): Promise<CheckOutcome> {
  const deviceId = await getDeviceId()
  const status = readStatus()
  const result = await postActivationAPI('/api/code/check', { deviceType: DEVICE_TYPE, deviceId })
  if (result.ok) {
    await writeStatus({ deviceId, activated: true, lastCheckedAt: Date.now() })
    return { ok: true }
  }
  // 区分网络失败 vs 业务失败：message 含「网络」/「超时」/「HTTP」→ network
  const reason = /网络|超时|HTTP/.test(result.message) ? 'network' : 'expired'
  return { ok: false, reason, message: result.message, previouslyActivated: !!status?.activated }
}

let pendingActivate = false
ipcMain.handle('activation:activate', async (_e, code: string) => {
  if (pendingActivate) return { ok: false, message: '正在处理，请稍候' }
  pendingActivate = true
  try {
    const cleaned = cleanActivationCode(code)
    const deviceId = await getDeviceId()
    const result = await postActivationAPI('/api/code/active', { activationCode: cleaned, deviceType: DEVICE_TYPE, deviceId })
    if (result.ok) {
      await writeStatus({ deviceId, activated: true, lastCheckedAt: Date.now() })
      // 通知渲染层 + 创建主窗口 + 关激活窗口（ready-to-show 后）
      onActivationSuccess()
    }
    return result
  } finally { pendingActivate = false }
})
ipcMain.handle('activation:get-device-id', async () => getDeviceId())
ipcMain.handle('activation:quit', () => app.quit())
```

**`src/main/activation-window.ts`** — 复用 [main-window.ts](file:///Users/hetaiyi/Desktop/my/tech/web/interview-coder-cn/src/main/main-window.ts) 的窗口创建模式，但普通窗口：
```ts
export function createActivationWindow(reason: 'expired' | 'network', message: string, previouslyActivated: boolean): void {
  const win = new BrowserWindow({
    width: 480, height: 560,
    frame: true, resizable: false, maximizable: false, minimizable: false,
    title: '激活', show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  })
  global.activationWindow = win
  win.setMenuBarVisibility(false)
  win.on('closed', () => { global.activationWindow = null; app.quit() })  // 关闭=退出
  win.on('ready-to-show', () => {
    win.show()
    win.webContents.send('activation:reason', { reason, message, previouslyActivated })
  })
  if (is.dev && process.env.ELECTRON_RENDERER_URL) win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#/activation`)
  else win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'activation' })
}
```

**`src/main/index.ts`** 修改 `app.whenReady()`：
```ts
app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.electron')
  applyDockVisibility(true)
  // session handlers ...

  // 启动校验
  const outcome = await runStartupCheck()
  if (outcome.ok) {
    createWindow()
    initAutoUpdater()
  } else {
    createActivationWindow(outcome.reason, outcome.message, outcome.previouslyActivated)
  }

  app.on('activate', () => { /* 原逻辑，激活期间不会触发 */ })
})
```

**`src/renderer/src/activation/index.tsx`** — ActivationPage：
- 顶部提示区（条件渲染：`reason === 'expired'` 显示「授权已失效，请重新激活」+ msg 副标题；`reason === 'network'` 显示「网络异常，请检查网络后重试」）
- 激活码输入框（`<input>` 支持粘贴，`onPaste` 不拦截）
- 激活按钮（`useState(false)` loading，点击后 `disabled` + 文案「激活中…」；`window.api.activationActivate(code)` 返回后失败显示 `result.message`，成功则等待主进程切窗）
- 设备 ID 展示（`window.api.activationGetDeviceId()` 拿到 → 显示前 8 位…；「复制设备 ID」按钮 `navigator.clipboard.writeText`）
- 错误提示区（红色文字内联，失败时显示）
- 成功后：主进程 `onActivationEnterMain` 事件 → 路由 `location.hash = '#/'` 或直接由主进程关窗建主窗

**`src/renderer/src/App.tsx`** 路由 + initShortcuts 跳过：
```tsx
<Route path="activation" element={<ActivationPage />} />
// initShortcuts useEffect:
if (location.pathname === '/activation') return  // 不注册快捷键
```

### 持久化文件结构（示例 `userData/activation.json`）
```json
{
  "deviceId": "e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2",
  "activated": true,
  "lastCheckedAt": 1728800000000
}
```

---

## 验证方法

启动校验功能无法用单元测试覆盖（依赖真实硬件指纹和网络），靠手动验收逐条对照需求【验收标准 1-8】：

1. **首次启动无记录**：删除 `userData/activation.json` → 启动 → 应直接显示激活页，无主界面闪现。
2. **错误激活码**：输入 `XXXX-XXXX` → 点激活 → 页面内联显示服务端返回的 msg（如「激活码不存在或已使用」），输入框内容保留，应用不崩溃、不跳页。
3. **正确激活码 + 重启**：输入有效码 → 激活成功 → 直接进主界面；杀进程重启 → 自动校验通过 → 直接进主界面，不显示激活页。
4. **服务端置失效**：用有效码激活后，让服务端把该 deviceId 置为失效（或换个 deviceId 模拟）→ 重启 → 应回到激活页，顶部提示「授权已失效，请重新激活」+ 服务端 msg。
5. **断网启动**：断网 → 启动 → 进激活页并显示「网络异常，请检查网络后重试」，不卡死在加载中。
6. **deviceType 数字 3**：在 `postActivationAPI` 调用处和 `activation.json` 不出现字符串 `"3"`；可在 devtools network 或主进程日志验证请求 body 是 `"deviceType":3`。
7. **deviceId 一致**：同机多次启动，`activation.json` 的 `deviceId` 不变；可在激活页「复制设备 ID」多次复制比对。
8. **防重复点击**：快速连点激活按钮，只有一次请求发出（按钮 loading 期间 disabled）。

**启动命令**：`npm run dev`（注意用 Node.js 20，Node 18 会导致 Vite 7 启动报错，见项目 memory）。

**自查清单**（写完后逐条对照）：
- [ ] `code == 0` 是唯一成功判断（不用 HTTP 200）
- [ ] `deviceType` 在所有请求里是数字 `3`
- [ ] `deviceId` 同机多次启动一致
- [ ] 激活按钮请求期间不可重复点击（前端 + 主进程双重防御）
- [ ] 本地缓存不替代服务端校验（校验失败必回激活页）
- [ ] 激活页独立全屏，无主界面功能入口
- [ ] 关闭激活页 = 退出应用（macOS 特殊处理）
- [ ] 激活成功不弹提示直接进主界面
- [ ] 失败有明确文案（服务端 msg 原样展示）
- [ ] 超时 10s，超时按校验失败处理
- [ ] 日志 deviceId 脱敏
