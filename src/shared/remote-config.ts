/**
 * The configuration the check API hands back with a passed check: the AI
 * endpoint and its key, the speech key, and the newest version with its
 * download link.
 *
 * It arrives in the response's `data`, itself a JSON string, so it is parsed
 * here rather than in either process. The server is authoritative: whatever it
 * sends replaces what was saved locally.
 */
export interface RemoteConfig {
  /** Newest published version, without the leading `v` */
  version: string
  /** OpenAI-compatible API Base URL for both modes */
  aiUrl: string
  aiKey: string
  /** DashScope key for real-time speech recognition */
  audioKey: string
  /** Where the newest version is downloaded from */
  downloadUrl: string
}

/** Endpoint names as the server spells them, in this file's terms */
const FIELDS = {
  version: 'version',
  aiUrl: 'aiUrl',
  aiKey: 'aiKey',
  audioKey: 'audioKey',
  downloadUrl: 'downloadUrl'
} as const

function readText(source: Record<string, unknown>, key: string): string {
  const value = source[key]
  if (typeof value !== 'string') return ''
  // Some servers wrap URLs in backticks when the value was copy-pasted
  return value.trim().replace(/^`+/, '').replace(/`+$/, '').trim()
}

/**
 * `data` may be the object itself or (as the server currently sends) a JSON
 * string around it. Null when there is nothing usable, so the caller keeps
 * whatever the app already had.
 */
export function parseRemoteConfig(data: unknown): RemoteConfig | null {
  let raw = data
  if (typeof raw === 'string') {
    raw = parseJsonLeniently(raw)
    if (raw === undefined) return null
  }
  if (!raw || typeof raw !== 'object') return null

  const source = raw as Record<string, unknown>
  const config: RemoteConfig = {
    version: readText(source, FIELDS.version).replace(/^v/i, ''),
    aiUrl: readText(source, FIELDS.aiUrl),
    aiKey: readText(source, FIELDS.aiKey),
    audioKey: readText(source, FIELDS.audioKey),
    downloadUrl: readText(source, FIELDS.downloadUrl)
  }
  const usable =
    config.version || config.aiUrl || config.aiKey || config.audioKey || config.downloadUrl
  return usable ? config : null
}

/**
 * The server currently leaves a comma after its last field, which strict JSON
 * rejects. Dropping commas before a closing brace or bracket accepts that
 * without loosening anything else.
 */
function parseJsonLeniently(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    try {
      return JSON.parse(text.replace(/,\s*([}\]])/g, '$1')) as unknown
    } catch {
      return undefined
    }
  }
}
