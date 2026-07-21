import { CheckCircle2, Info, Undo2, X, XCircle } from 'lucide-react'
import { useToasts } from '@/state/toasts'

export function Toasts() {
  const { toasts, dismiss } = useToasts()
  if (toasts.length === 0) return null
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-[calc(100vw-2rem)] sm:w-96" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="bg-surface-2 border border-line-strong rounded-xl shadow-pop px-4 py-3 flex items-start gap-3 animate-slide-up"
          role="status"
        >
          {t.kind === 'success' && <CheckCircle2 size={17} className="text-ok-400 mt-0.5 shrink-0" />}
          {t.kind === 'error' && <XCircle size={17} className="text-bad-400 mt-0.5 shrink-0" />}
          {t.kind === 'info' && <Info size={17} className="text-info-400 mt-0.5 shrink-0" />}
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-bold">{t.title}</div>
            {t.message && <div className="text-xs text-ink-mid leading-relaxed mt-0.5">{t.message}</div>}
            {t.undo && (
              <button
                onClick={() => { t.undo!(); dismiss(t.id) }}
                className="mt-1.5 inline-flex items-center gap-1 text-xs font-bold text-brand-300 hover:text-brand-400"
              >
                <Undo2 size={12} /> Undo
              </button>
            )}
          </div>
          <button onClick={() => dismiss(t.id)} className="text-ink-low hover:text-ink-hi shrink-0" aria-label="Dismiss notification">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
