import { useState } from 'react'
import { Lightbulb, MessageCircle, Mic, MicOff, OctagonX, PointerOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import ShortcutRenderer from '@/components/ShortcutRenderer'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useAppStore } from '@/lib/store/app'
import { useSettingsStore, type HintMode } from '@/lib/store/settings'
import { useShortcutsStore } from '@/lib/store/shortcuts'
import { useTranscriptionStore } from '@/lib/store/transcription'
import { useConversationStore } from '@/lib/store/conversation'
import { toggleHintMode, toggleListening } from './listening'

const HINT_MODES: { value: HintMode; label: string }[] = [
  { value: 'auto', label: '自动' },
  { value: 'manual', label: '手动' }
]

/** Listening, automatic / manual hints and the hint button, each with its shortcut */
export function ConversationStatusBar() {
  const { ignoreMouse } = useAppStore()
  const { shortcuts } = useShortcutsStore()
  const hintMode = useSettingsStore((state) => state.conversationHintMode)
  const hideShortcutHints = useSettingsStore((state) => state.hideShortcutHints)
  const isTranscribing = useTranscriptionStore((state) => state.isTranscribing)
  const streaming = useConversationStore((state) =>
    state.hints.some((h) => h.status === 'streaming' || h.status === 'waiting')
  )
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [questionInput, setQuestionInput] = useState('')

  const key = (action: string) =>
    !hideShortcutHints && (
      <ShortcutRenderer
        shortcut={shortcuts[action].key}
        className="inline-block scale-75 border border-current bg-transparent px-1 py-0 text-xs"
      />
    )

  const handleDialogClose = () => {
    setIsDialogOpen(false)
    setQuestionInput('')
  }

  const handleSubmitQuestion = () => {
    const question = questionInput.trim()
    if (!question) return
    void window.api.sendConversationFollowUp(question)
    handleDialogClose()
  }

  // One line whatever the width: wrapped, the labels ran past the bar's fixed
  // height and the bottom of the window (#140). A window too narrow for them
  // all clips the last ones instead, the click-through note giving way first
  return (
    <div className="flex h-8 shrink-0 items-center gap-3 overflow-hidden border-t border-app-border bg-app-status px-3 text-xs whitespace-nowrap text-app-status-fg select-none">
      <button className="flex items-center gap-1 cursor-pointer" onClick={toggleListening}>
        {isTranscribing ? <Mic className="size-3.5" /> : <MicOff className="size-3.5 opacity-55" />}
        {isTranscribing ? '停止监听' : '开始监听'}
        {key('toggleTranscription')}
      </button>

      <div className="flex items-center gap-1">
        <div className="flex items-center rounded-md bg-app-chip p-0.5">
          {HINT_MODES.map(({ value, label }) => (
            <button
              key={value}
              className={cn(
                'rounded px-1.5 py-0.5',
                value === hintMode
                  ? 'bg-[var(--app-hover-bg)]'
                  : 'opacity-60 hover:opacity-100 cursor-pointer'
              )}
              onClick={() => value !== hintMode && toggleHintMode()}
            >
              {label}
            </button>
          ))}
        </div>
        {key('toggleHintMode')}
      </div>

      {streaming ? (
        <button
          className="flex items-center gap-1 cursor-pointer"
          onClick={() => void window.api.stopHints()}
        >
          <OctagonX className="size-3.5" />
          停止
          {key('stopSolutionStream')}
        </button>
      ) : (
        <button
          className="flex items-center gap-1 cursor-pointer"
          onClick={() => void window.api.requestHint()}
        >
          <Lightbulb className="size-3.5" />
          出提示
          {key('generateHint')}
        </button>
      )}

      <button className="flex items-center gap-1 cursor-pointer" onClick={() => setIsDialogOpen(true)}>
        <MessageCircle className="size-3.5" />
        追问问题
      </button>

      {ignoreMouse && (
        <span className="ml-auto flex min-w-0 items-center gap-1">
          <PointerOff className="size-3.5 shrink-0" />
          <span className="truncate">取消鼠标穿透</span>
          {key('ignoreOrEnableMouse')}
        </span>
      )}

      {/* Follow-up Question Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogTitle className="sr-only">追问</DialogTitle>
        <DialogContent>
          <div className="py-4">
            <Textarea
              placeholder="请输入追问内容，按 Ctrl/⌘+Enter 提交..."
              value={questionInput}
              className="min-h-24"
              onChange={(e) => setQuestionInput(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  handleSubmitQuestion()
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleDialogClose}>
              取消
            </Button>
            <Button onClick={handleSubmitQuestion} disabled={!questionInput.trim()}>
              提交
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
