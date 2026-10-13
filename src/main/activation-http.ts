import { request } from 'node:http'
import { ACTIVATION_BASE_URL, type ActivationResult } from '../shared/activation'

/**
 * 激活 / 校验接口的统一请求方法。POST + form-urlencoded，10 秒超时。
 *
 * 用 node:http 而非 global.fetch：Electron 主进程的 fetch 会走 session，
 * 导致请求被服务端误判（实测 Node fetch 通过，Electron fetch 报 deviceType
 * is empty，相同 body 不同结果）。node:http 走纯 Node 网络栈，不受 Electron
 * session 影响。
 *
 * 用 form-urlencoded 而非 JSON：后端 Controller 的 active/check 方法参数
 * 没有 @RequestBody 注解，Spring 走表单绑定，JSON body 不会被解析，导致
 * @NotNull 校验失败。form 提交能被正确绑定（curl 实测激活成功）。
 *
 * 处理三类失败并统一压成 `{ ok: false, message }`：
 * 1. 网络层失败（DNS / 连接 / 超时）→ 「网络异常...」或「请求超时」
 * 2. HTTP 非 2xx → 「服务端返回 HTTP N」
 * 3. JSON 解析失败 → 「服务端响应格式异常」
 *
 * 判断成功的唯一依据是响应体里的 code == 0，绝不依赖 HTTP 状态码 200。
 */

/** 把对象转成 application/x-www-form-urlencoded 字符串 */
function toFormBody(body: unknown): string {
  if (typeof body !== 'object' || body === null) return ''
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined && value !== null) {
      params.append(key, String(value))
    }
  }
  return params.toString()
}

function httpPost(url: string, body: unknown, timeoutMs = 10_000): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const bodyStr = toFormBody(body)
    const req = request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 80,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(bodyStr)
        }
      },
      (res) => {
        let data = ''
        res.setEncoding('utf-8')
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text: data }))
      }
    )
    req.on('error', reject)
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('timeout'))
    })
    req.write(bodyStr)
    req.end()
  })
}

export async function postActivationAPI(
  path: string,
  body: unknown
): Promise<ActivationResult> {
  const url = `${ACTIVATION_BASE_URL}${path}`
  const bodyStr = toFormBody(body)
  console.log('[activation] POST', url, 'form:', bodyStr)

  let res: { status: number; text: string }
  try {
    res = await httpPost(url, body)
  } catch (err) {
    const timedOut = err instanceof Error && /timeout/i.test(err.message)
    return {
      ok: false,
      message: timedOut ? '请求超时，请检查网络后重试' : '网络异常，请检查网络后重试'
    }
  }

  if (res.status < 200 || res.status >= 300) {
    return { ok: false, message: `服务端返回 HTTP ${res.status}` }
  }

  console.log('[activation] response status:', res.status, 'raw:', res.text)

  let json: { code?: unknown; msg?: unknown; data?: unknown }
  try {
    json = JSON.parse(res.text) as typeof json
  } catch {
    return { ok: false, message: '服务端响应格式异常' }
  }

  if (json.code === 0) {
    return {
      ok: true,
      message: typeof json.msg === 'string' && json.msg ? json.msg : '操作成功',
      data: json.data ?? undefined
    }
  }

  return {
    ok: false,
    message: typeof json.msg === 'string' && json.msg ? json.msg : '操作失败'
  }
}
