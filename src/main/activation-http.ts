import { ACTIVATION_BASE_URL, type ActivationResult } from '../shared/activation'

/**
 * 激活 / 校验接口的统一请求方法。POST + JSON，10 秒超时。
 *
 * 处理三类失败并统一压成 `{ ok: false, message }`：
 * 1. 网络层失败（DNS / 连接 / 超时）→ 「网络异常...」或「请求超时」
 * 2. HTTP 非 2xx → 「服务端返回 HTTP N」
 * 3. JSON 解析失败 → 「服务端响应格式异常」
 *
 * 判断成功的唯一依据是响应体里的 code == 0，绝不依赖 HTTP 状态码 200。
 */
export async function postActivationAPI(
  path: string,
  body: unknown
): Promise<ActivationResult> {
  const url = `${ACTIVATION_BASE_URL}${path}`
  const bodyStr = JSON.stringify(body)
  console.log('[activation] POST', url, 'body:', bodyStr)

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyStr,
      signal: AbortSignal.timeout(10_000)
    })
  } catch (err) {
    const timedOut =
      err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    return {
      ok: false,
      message: timedOut ? '请求超时，请检查网络后重试' : '网络异常，请检查网络后重试'
    }
  }

  if (!res.ok) {
    return { ok: false, message: `服务端返回 HTTP ${res.status}` }
  }

  let json: { code?: unknown; msg?: unknown; data?: unknown }
  try {
    json = (await res.json()) as typeof json
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
