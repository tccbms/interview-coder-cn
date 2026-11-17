import { net } from 'electron'
import { API_BASE_URL, type AuthResult } from '../shared/auth'

/**
 * 通用 API 请求模块：form POST / query GET，统一处理：
 * - 15s 超时
 * - { code, msg, data } 信封，code 0 成功
 * - data 为 JSON 字符串（含尾逗号）时还原成对象
 * - 401 单独标记，调用方据此回登录页
 * - 日志脱敏：密码、sk- key、Authorization 不落地
 */

export interface ApiResult extends AuthResult {
  /** HTTP 状态码或业务 code，便于区分 401 */
  code?: number
}

function redactSecrets(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9._-]{6,}/g, 'sk-***')
    .replace(/password=[^&]*/g, 'password=***')
    .replace(/("(?:token|aiKey|audioKey)"\s*:\s*")[^"]{6,}(")/g, '$1***$2')
}

/** data 可能是 JSON 字符串（含尾逗号），统一还原成对象；解析失败保持原样 */
function normalizeData(data: unknown): unknown {
  if (typeof data !== 'string') return data
  try {
    return JSON.parse(data) as unknown
  } catch {
    try {
      return JSON.parse(data.replace(/,\s*([}\]])/g, '$1')) as unknown
    } catch {
      return data
    }
  }
}

interface RequestOptions {
  method: 'GET' | 'POST'
  params: Record<string, string>
  token?: string
}

async function request(path: string, options: RequestOptions): Promise<ApiResult> {
  const { method, params, token } = options
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    // 服务端从 form/query 的 token 参数取凭证，不走 Authorization 头
    const finalParams = token ? { ...params, token } : params
    const headers: Record<string, string> = {}
    let url = `${API_BASE_URL}${path}`
    let body: string | undefined
    if (method === 'POST') {
      body = new URLSearchParams(finalParams).toString()
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
    } else {
      url += `?${new URLSearchParams(finalParams).toString()}`
    }
    console.log('[api]', method, url, body ? `form: ${redactSecrets(body)}` : '')
    const res = await net.fetch(url, { method, headers, body, signal: controller.signal })
    const text = await res.text()
    console.log('[api] response status:', res.status, 'raw:', redactSecrets(text))

    if (res.status === 401) {
      return { ok: false, code: 401, message: '登录已过期，请重新登录' }
    }
    if (res.status >= 400) {
      return { ok: false, message: `服务异常(HTTP ${res.status})` }
    }

    let json: { code?: number; msg?: string; data?: unknown }
    try {
      json = JSON.parse(text) as { code?: number; msg?: string; data?: unknown }
    } catch {
      return { ok: false, message: `服务响应格式错误(HTTP ${res.status})` }
    }
    if (typeof json.code !== 'number') {
      return { ok: false, message: '服务响应缺少 code 字段' }
    }
    const data = normalizeData(json.data)
    if (json.code !== 0) {
      return {
        ok: false,
        code: json.code,
        message: json.msg || `操作失败(code=${json.code})`,
        data
      }
    }
    return { ok: true, message: json.msg || 'success', data }
  } catch (error) {
    if (controller.signal.aborted) {
      return { ok: false, message: '请求超时，请检查网络后重试' }
    }
    console.error('[api] request error:', error)
    return { ok: false, message: '网络异常，请检查网络后重试' }
  } finally {
    clearTimeout(timer)
  }
}

export function postForm(
  path: string,
  params: Record<string, string>,
  token?: string
): Promise<ApiResult> {
  return request(path, { method: 'POST', params, token })
}

export function getJSON(
  path: string,
  params: Record<string, string>,
  token?: string
): Promise<ApiResult> {
  return request(path, { method: 'GET', params, token })
}
