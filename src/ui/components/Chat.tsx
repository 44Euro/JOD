import { ArrowUp, CircleAlert, Plus, RotateCw, Square, Trash2, X } from 'lucide-react'
import { useContext, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link } from 'react-router'
import { CHAT_HISTORY_STORAGE_KEY, chatReady, readLocal, useProviderSettings, useReaderMode, writeLocal } from '../../ai/apiKey'
import { ask, type ChatImage, type ChatMessage } from '../../ai/chat'
import { ChatModelContext } from '../../ai/chatProviders'
import { FileError, prepareFile } from '../../ai/files'
import { AiError, isAbort, type ReaderMode } from '../../ai/reader'
import type { ProviderSettings } from '../../ai/otherReaders'
import { todayLocal } from '../../domain/dates'
import { marketClient } from '../../market/client'
import { cn } from '../../lib/cn'
import { chatSuggestions, chatSystem, chatTools, TOOL_LABELS } from '../chatTools'
import { useAppData, useInvestor } from '../hooks'
import { READER_MODE_LABELS } from '../labels'
import { t } from '../../i18n'

interface Said {
  role: 'user' | 'assistant'
  text: string
  used?: string[]
  image?: boolean
  stopped?: boolean
}

const KEEP = 40
const SEND = 20

function readHistory(): Said[] {
  try {
    const parsed = JSON.parse(readLocal(CHAT_HISTORY_STORAGE_KEY) || '[]') as unknown
    return Array.isArray(parsed) ? (parsed as Said[]) : []
  } catch {
    return []
  }
}

// The model gets the latest turns as plain text, starting with a question.
function forModel(history: readonly Said[]): ChatMessage[] {
  const recent = history.slice(-SEND)
  const start = recent.findIndex((m) => m.role === 'user')
  return start < 0 ? [] : recent.slice(start).map(({ role, text }) => ({ role, text }))
}

function providerName(mode: ReaderMode, settings: ProviderSettings): string {
  if (mode === 'compatible' && settings.baseUrl) {
    try {
      return new URL(settings.baseUrl).host
    } catch {
      return READER_MODE_LABELS[mode]
    }
  }
  return READER_MODE_LABELS[mode]
}

const ICON_BUTTON =
  'grid size-10 shrink-0 place-items-center rounded-full text-board-mine transition-colors hover:bg-board-line focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-board-mine/60 disabled:opacity-40'

const RECOVER =
  'inline-flex h-11 items-center gap-1.5 rounded-full border border-board-line px-4 text-[13px] text-white transition-colors hover:bg-board-line focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-board-mine/60'

// The money-route mark: a white station, a violet currency station and a white one, joined by the route.
function RouteMark() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className="size-9">
      <path d="M14 42 L30 24 L50 24" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="14" cy="42" r="6" className="fill-board" stroke="currentColor" strokeWidth="4" />
      <circle cx="30" cy="24" r="6" className="fill-board stroke-board-fx" strokeWidth="4" />
      <circle cx="50" cy="24" r="6" className="fill-board" stroke="currentColor" strokeWidth="4" />
    </svg>
  )
}

// Always shown so people find the chat; until a provider with the person's own key is set it explains how to turn it on.
export function ChatOrb() {
  const mode = useReaderMode()
  const settings = useProviderSettings(mode)
  const [open, setOpen] = useState(false)
  const orb = useRef<HTMLButtonElement>(null)
  const ready = chatReady(mode, settings)
  // The orb takes the focus back itself: a cleanup in the sheet would also run on React's development remount.
  const close = () => {
    setOpen(false)
    orb.current?.focus()
  }
  return (
    <>
      <button
        ref={orb}
        type="button"
        aria-label={t('ถาม JOD')}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="fixed right-4 bottom-[calc(max(env(safe-area-inset-bottom),22px)+72px)] z-20 grid size-14 place-items-center rounded-full bg-board text-white shadow-[0_4px_12px_-4px_rgb(11_31_58/0.35)] transition-[background-color,transform] duration-150 ease-out hover:bg-board-line focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-board-mine/70 active:scale-[0.97] md:right-8 md:bottom-8 print:hidden"
      >
        <RouteMark />
      </button>
      {open && (ready ? <ChatSheet provider={providerName(mode, settings)} mode={mode} settings={settings} onClose={close} /> : <SetupSheet onClose={close} />)}
    </>
  )
}

function SetupSheet({ onClose }: { onClose(): void }) {
  const id = useId()
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-30 flex items-end bg-[rgb(11_31_58/0.45)] md:justify-end md:p-8" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        className="grid w-full gap-4 rounded-t-[28px] bg-board px-5 pt-5 pb-[max(env(safe-area-inset-bottom),20px)] text-white md:max-w-[440px] md:rounded-[20px] md:pb-5"
      >
        <div className="flex items-start gap-1">
          <h2 id={`${id}-title`} className="flex-1 pt-1 text-lg font-semibold">
            {t('ถาม JOD')}
          </h2>
          <button type="button" aria-label={t('ปิด')} className={ICON_BUTTON} onClick={onClose}>
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <p className="text-[15px] leading-relaxed text-board-muted">
          {t('ถามเรื่องพอร์ต ปันผล ข่าว หรือราคาหุ้นได้ · เลือก AI และใส่ key ของคุณในหน้าตั้งค่าก่อน')}
        </p>
        <Link to="/settings" onClick={onClose} className="inline-flex h-11 items-center justify-self-start rounded-full bg-white px-5 text-[15px] font-medium text-board transition-colors hover:bg-board-mine focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-board-mine/60">
          {t('ไปตั้งค่า AI')}
        </Link>
      </div>
    </div>
  )
}

function ChatSheet({ provider, mode, settings, onClose }: { provider: string; mode: ReaderMode; settings: ProviderSettings; onClose(): void }) {
  const id = useId()
  const createModel = useContext(ChatModelContext)
  const data = useAppData()
  const { ledger, valuations, investor } = useInvestor(data)
  const today = todayLocal()
  const snapshot = useMemo(
    () =>
      data && ledger && investor
        ? { accounts: data.accounts, instruments: data.instruments, transactions: data.transactions, base: data.settings.baseCurrency, ledger, valuations, investor, today }
        : null,
    [data, ledger, valuations, investor, today],
  )
  const [history, setHistory] = useState(readHistory)
  const [draft, setDraft] = useState('')
  const [image, setImage] = useState<ChatImage | null>(null)
  const [pending, setPending] = useState<{ question: Said; text: string; tool?: string } | null>(null)
  // A failed question stays in view with its picture, so it can be sent again as it was.
  const [error, setError] = useState<{ message: string; failed?: { question: Said; image: ChatImage | null } } | null>(null)
  const running = useRef<AbortController | null>(null)
  const log = useRef<HTMLOListElement>(null)

  useEffect(() => () => running.current?.abort(), [])
  // Escape closes the sheet wherever the focus is, including after a click on the text left it on the page.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  useEffect(() => {
    log.current?.lastElementChild?.scrollIntoView?.({ block: 'end' })
  }, [history, pending])

  function keep(next: Said[]) {
    const kept = next.slice(-KEEP)
    writeLocal(CHAT_HISTORY_STORAGE_KEY, kept.length > 0 ? JSON.stringify(kept) : '')
    setHistory(kept)
  }

  async function send(typed: string, attached: ChatImage | null = image) {
    const text = typed.trim()
    const image = attached
    if (!snapshot || pending || (!text && !image)) return
    const question: Said = { role: 'user', text: text || t('ช่วยดูรูปนี้ให้หน่อย'), ...(image ? { image: true } : {}) }
    const controller = new AbortController()
    running.current = controller
    const used = new Set<string>()
    let streamed = ''
    setDraft('')
    setImage(null)
    setError(null)
    setPending({ question, text: '' })
    try {
      const answer = await ask(
        createModel(mode, settings),
        chatSystem(today, snapshot.base),
        [...forModel(history), { role: 'user', text: question.text, ...(image ? { image } : {}) }],
        chatTools(snapshot, marketClient),
        {
          text: (delta) => {
            streamed += delta
            setPending((p) => p && { ...p, text: p.text + delta, tool: undefined })
          },
          tool: (name) => {
            used.add(name)
            setPending((p) => p && { ...p, tool: name })
          },
        },
        controller.signal,
      )
      keep([...history, question, { role: 'assistant', text: answer.text, used: answer.used }])
    } catch (caught) {
      if (isAbort(caught) && streamed.trim()) {
        keep([...history, question, { role: 'assistant', text: streamed.trim(), used: [...used], stopped: true }])
      } else if (isAbort(caught)) {
        setDraft(text)
        setImage(image)
      } else {
        setError({ message: caught instanceof AiError ? caught.message : t('ตอบไม่สำเร็จ ลองใหม่อีกครั้ง'), failed: { question, image } })
      }
    } finally {
      running.current = null
      setPending(null)
    }
  }

  async function attach(file: File | undefined) {
    if (!file) return
    setError(null)
    try {
      const prepared = await prepareFile(file)
      if (prepared.kind !== 'image') throw new FileError(t('แนบได้เฉพาะรูป'))
      setImage(prepared)
    } catch (caught) {
      setError({ message: caught instanceof FileError ? caught.message : t('เปิดรูป {0} ไม่ได้', file.name) })
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void send(draft)
  }

  function onComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void send(draft)
    }
  }

  const suggestions = snapshot && history.length === 0 && !pending ? chatSuggestions(snapshot) : []
  const usedLine = (used: readonly string[] = []) =>
    used.length > 0 ? t('ใช้ข้อมูล: {0}', used.map((name) => TOOL_LABELS[name] ?? name).join(' · ')) : t('ไม่ได้ใช้ข้อมูลพอร์ตหรือตลาด')

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-[rgb(11_31_58/0.45)] md:justify-end md:p-8" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        className="flex h-[88dvh] w-full flex-col rounded-t-[28px] bg-board pb-[max(env(safe-area-inset-bottom),12px)] text-white shadow-[0_-12px_40px_-12px_rgb(11_31_58/0.6)] md:h-[min(720px,calc(100dvh-64px))] md:max-w-[440px] md:rounded-[20px] md:pb-0 md:shadow-[0_24px_56px_-20px_rgb(11_31_58/0.6)]"
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-board-line md:hidden" aria-hidden />
        <div className="flex items-start gap-1 border-b border-board-line py-3 pr-3 pl-5">
          <div className="min-w-0 flex-1 pt-1">
            <h2 id={`${id}-title`} className="truncate text-lg font-semibold">
              {t('ถาม JOD · {0}', provider)}
            </h2>
            <p className="text-[13px] text-board-muted">{t('ใช้ key ของคุณ · ประวัติเก็บในเครื่องนี้เท่านั้น')}</p>
          </div>
          {history.length > 0 && !pending && (
            <button type="button" aria-label={t('ล้างประวัติแชต')} className={ICON_BUTTON} onClick={() => keep([])}>
              <Trash2 className="size-[18px]" aria-hidden />
            </button>
          )}
          <button type="button" aria-label={t('ปิด')} className={ICON_BUTTON} onClick={onClose}>
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {history.length === 0 && !pending && (
            <p className="max-w-[34ch] text-[15px] leading-relaxed text-board-muted">
              {t('ถามเรื่องพอร์ต ปันผล ข่าว หรือราคาหุ้นได้')}
            </p>
          )}
          <ol ref={log} aria-label={t('บทสนทนา')} aria-busy={pending !== null} className="grid gap-4">
            {[...history, ...(pending ? [pending.question] : [])].map((said, i) =>
              said.role === 'user' ? (
                <li key={i} className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-board-line px-3.5 py-2 text-[15px] whitespace-pre-wrap">
                  {said.image && <span className="mb-0.5 block text-[12px] text-board-muted">{t('แนบรูป')}</span>}
                  {said.text}
                </li>
              ) : (
                <li key={i} className="grid gap-1.5">
                  <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{said.text}</p>
                  <p className="text-[12px] text-board-muted">
                    {usedLine(said.used)}
                    {said.stopped && ` · ${t('หยุดไว้')}`}
                  </p>
                </li>
              ),
            )}
            {error?.failed && (
              <li className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-board-line/60 px-3.5 py-2 text-[15px] whitespace-pre-wrap">
                {error.failed.question.image && <span className="mb-0.5 block text-[12px] text-board-muted">{t('แนบรูป')}</span>}
                {error.failed.question.text}
                <span className="mt-0.5 block text-[12px] text-board-loss">{t('ส่งไม่สำเร็จ')}</span>
              </li>
            )}
            {pending && (
              <li className="grid gap-1.5">
                {pending.text && <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{pending.text}</p>}
                <p className="text-[12px] text-board-muted">{pending.tool ? t('กำลังดู{0}…', TOOL_LABELS[pending.tool] ?? pending.tool) : t('กำลังตอบ…')}</p>
              </li>
            )}
          </ol>
          {error && (
            <div role="alert" className="mt-4 flex gap-2.5 rounded-xl border border-board-loss/40 bg-board-loss/10 px-3.5 py-3 text-[15px] text-board-loss">
              <CircleAlert className="mt-0.5 size-[18px] shrink-0" aria-hidden />
              <div className="grid min-w-0 gap-2.5">
                <p>{error.message}</p>
                {error.failed && (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={RECOVER} onClick={() => error.failed && void send(error.failed.question.text, error.failed.image)}>
                      <RotateCw className="size-4" aria-hidden />
                      {t('ลองอีกครั้ง')}
                    </button>
                    <Link to="/settings" className={RECOVER} onClick={onClose}>
                      {t('ไปหน้าตั้งค่า')}
                    </Link>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {suggestions.length > 0 && (
          <div role="group" aria-label={t('คำถามแนะนำ')} className="flex flex-wrap gap-2 px-4 pb-3">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void send(s)}
                className="rounded-full border border-board-line px-3.5 py-2 text-left text-[13px] text-board-mine transition-colors hover:bg-board-line focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-board-mine/60"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {image && (
          <div className="flex items-center gap-2 px-4 pb-2 text-[13px] text-board-mine">
            <img src={image.previewUrl} alt="" className="size-8 rounded-md object-cover" />
            <span className="min-w-0 truncate">{image.name}</span>
            <button type="button" aria-label={t('เอารูปออก')} className={cn(ICON_BUTTON, 'size-8')} onClick={() => setImage(null)}>
              <X className="size-4" aria-hidden />
            </button>
          </div>
        )}

        <form onSubmit={onSubmit} className="flex items-end gap-1.5 border-t border-board-line px-3 pt-3 md:pb-3">
          <label className={cn(ICON_BUTTON, 'cursor-pointer has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-board-mine/60')}>
            <Plus className="size-5" aria-hidden />
            <input
              type="file"
              accept="image/*"
              aria-label={t('แนบภาพหน้าจอ')}
              className="sr-only"
              disabled={pending !== null}
              onChange={(e) => {
                void attach(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </label>
          <textarea
            aria-label={t('คำถาม')}
            autoFocus
            rows={1}
            enterKeyHint="send"
            placeholder={t('ถามเรื่องพอร์ตของคุณ…')}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onComposerKey}
            className="max-h-32 min-h-10 min-w-0 flex-1 resize-none rounded-[20px] bg-board-line px-4 py-2 text-base text-white [field-sizing:content] placeholder:text-board-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-board-mine/60"
          />
          {pending ? (
            <button type="button" aria-label={t('หยุด')} className={cn(ICON_BUTTON, 'bg-white text-board hover:bg-board-mine')} onClick={() => running.current?.abort()}>
              <Square className="size-4 fill-current" aria-hidden />
            </button>
          ) : (
            <button type="submit" aria-label={t('ส่ง')} disabled={!snapshot || (!draft.trim() && !image)} className={cn(ICON_BUTTON, 'bg-white text-board hover:bg-board-mine')}>
              <ArrowUp className="size-5" aria-hidden />
            </button>
          )}
        </form>
        <p className="px-5 pt-2 pb-1 text-[12px] text-board-muted md:pb-3">{t('คำถามและตัวเลขที่ AI ขอดูส่งไปที่ {0} โดยตรง ไม่ผ่านเซิร์ฟเวอร์ JOD', provider)}</p>
      </div>
    </div>
  )
}
