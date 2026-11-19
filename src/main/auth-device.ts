import { execSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { networkInterfaces } from 'node:os'
import { app } from 'electron'
import { maskDeviceId } from '../shared/auth'

/**
 * 设备唯一标识的生成与持久化。
 *
 * 生成顺序（保证同一台机器稳定一致）：
 * 1. 优先读磁盘已存的 deviceId（持久化后直接复用，避免每次重算）
 * 2. 硬件指纹：mac `system_profiler`、win PowerShell `wmic`
 * 3. 降级：非虚拟 MAC 地址
 * 4. 最后降级：randomUUID()（重启后靠磁盘复用保持稳定）
 *
 * 取到指纹后先 trim + toLowerCase 规范化，再 SHA256 哈希成字符串，
 * 避免直接暴露硬件信息，也保证不同 macOS 版本格式微变时结果稳定。
 *
 * 持久化到 `userData/device.json`，原子写（.tmp 再 rename）。
 * 兼容旧的 activation.json：老用户的 deviceId 直接沿用，不重新生成。
 */

const FILE_NAME = 'device.json'
const LEGACY_FILE_NAME = 'activation.json'

let cachedDeviceId: string | null = null

function readSavedDeviceId(): string | null {
  for (const name of [FILE_NAME, LEGACY_FILE_NAME]) {
    try {
      const path = join(app.getPath('userData'), name)
      if (!existsSync(path)) continue
      const saved = JSON.parse(readFileSync(path, 'utf-8')) as { deviceId?: unknown }
      if (typeof saved.deviceId === 'string' && saved.deviceId) {
        return saved.deviceId
      }
    } catch (error) {
      console.error('[auth] Failed to read device id:', error)
    }
  }
  return null
}

async function saveDeviceId(deviceId: string): Promise<void> {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    const path = join(app.getPath('userData'), FILE_NAME)
    const temp = `${path}.tmp`
    await writeFile(temp, JSON.stringify({ deviceId }, null, 2), 'utf-8')
    await rename(temp, path)
  } catch (error) {
    console.error('[auth] Failed to save device id:', error)
  }
}

/** macOS：system_profiler 取主板序列号 + 硬件 UUID */
function collectMacFingerprint(): string | null {
  try {
    const out = execSync('system_profiler SPHardwareDataType', {
      timeout: 5000,
      encoding: 'utf-8'
    })
    const serial = /Serial Number.*?:\s*([^\r\n]+)/i.exec(out)?.[1]?.trim()
    const uuid = /Hardware UUID.*?:\s*([^\r\n]+)/i.exec(out)?.[1]?.trim()
    const fingerprint = [serial, uuid].filter(Boolean).join('|')
    return fingerprint || null
  } catch {
    return null
  }
}

/** Windows：主板序列号 + CPU ProcessorId */
function collectWindowsFingerprint(): string | null {
  try {
    const cmd = `powershell -NoProfile -Command "$b=Get-WmiObject Win32_BaseBoard|Select-Object -ExpandProperty SerialNumber;$p=Get-WmiObject Win32_Processor|Select-Object -ExpandProperty ProcessorId;Write-Output ($b+'|'+$p)"`
    const out = execSync(cmd, { timeout: 8000, encoding: 'utf-8' }).trim()
    return out && out !== '|' ? out : null
  } catch {
    return null
  }
}

/** 降级：取第一块非虚拟、非全零 MAC 地址 */
function collectMacAddress(): string | null {
  try {
    const interfaces = networkInterfaces()
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] ?? []) {
        if (iface.mac && iface.mac !== '00:00:00:00:00:00' && !iface.internal) {
          return iface.mac
        }
      }
    }
  } catch {
    /* fall through */
  }
  return null
}

function collectHardwareFingerprint(): string | null {
  if (process.platform === 'darwin') {
    return collectMacFingerprint()
  }
  if (process.platform === 'win32') {
    return collectWindowsFingerprint() ?? collectMacAddress()
  }
  return collectMacAddress()
}

function generateDeviceId(): string {
  const fingerprint = collectHardwareFingerprint()
  if (fingerprint) {
    const normalized = fingerprint.trim().toLowerCase()
    const hash = createHash('sha256').update(normalized).digest('hex')
    console.log('[auth] deviceId from hardware fingerprint:', maskDeviceId(hash))
    return hash
  }
  const uuid = randomUUID()
  console.log('[auth] deviceId from randomUUID (hardware unavailable):', maskDeviceId(uuid))
  return uuid
}

/**
 * 取设备唯一 ID。优先复用磁盘已存的值；没有才生成并持久化。
 * 生成成功后立即写盘，后续启动直接读取，不重新计算。
 */
export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId
  const saved = readSavedDeviceId()
  if (saved) {
    cachedDeviceId = saved
    return saved
  }
  const id = generateDeviceId()
  cachedDeviceId = id
  await saveDeviceId(id)
  return id
}
