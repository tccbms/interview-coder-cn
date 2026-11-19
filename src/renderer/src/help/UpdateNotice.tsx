import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/lib/store/app'
import { isMac } from '@/lib/utils/env'

/** A newer release the check API announced: the app only points to its download page */
export function UpdateNotice() {
  const update = useAppStore((state) => state.update)
  if (!update) return null

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-emerald-600/50 bg-emerald-600/10 p-4">
      <div className="min-w-0 flex-1 space-y-1">
        <h3 className="font-semibold">
          发现新版本 v{update.version}
          <a
            href={update.url}
            target="_blank"
            rel="noreferrer"
            className="ml-2 text-sm font-normal text-blue-600 hover:underline"
          >
            查看更新内容
          </a>
        </h3>
        <p className="text-sm break-words text-gray-700">
          {isMac
            ? '到发布页下载 dmg，把应用拖入「应用程序」替换旧版即可，设置和资料都会保留。替换后如果截图或语音不能用，到「系统设置 → 隐私与安全性 → 屏幕与系统音频录制」里删掉本应用，再重新添加。'
            : '到发布页下载安装包，运行后覆盖安装即可，设置和资料都会保留。'}
        </p>
      </div>
      <Button asChild size="sm">
        <a href={update.url} target="_blank" rel="noreferrer">
          <ExternalLink />
          前往下载
        </a>
      </Button>
    </div>
  )
}
