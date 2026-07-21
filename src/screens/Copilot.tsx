// Copilot Console (spec §15, §16): natural-language Q&A over certified
// metrics. Every answer renders the agent contract — claim, evidence,
// confidence, limitations, next action. No evidence → the agent says so.
import { clsx } from 'clsx'
import { BrainCircuit, Eraser, Send } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button, Card, ConfidencePill } from '@/components/ui'
import { SUGGESTED_PROMPTS } from '@/domain/agents/copilot'
import { fmtDateTime } from '@/lib/format'
import { useApp } from '@/state/store'

export function Copilot() {
  const app = useApp()
  const [input, setInput] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [app.copilotMessages.length, app.copilotThinking])

  const send = (q?: string) => {
    const question = (q ?? input).trim()
    if (!question || app.copilotThinking) return
    app.askCopilot(question)
    setInput('')
    inputRef.current?.focus()
  }

  return (
    <div className="animate-fade-in flex flex-col" style={{ minHeight: 'calc(100vh - 8.5rem)' }}>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight flex items-center gap-2">
            <BrainCircuit size={20} className="text-brand-300" /> Copilot Console
          </h1>
          <p className="text-[13px] text-ink-mid">
            Read-only, proposal-only agents (spec §15). Answers cite certified metrics — and say explicitly when evidence is missing.
          </p>
        </div>
        {app.copilotMessages.length > 0 && (
          <Button variant="ghost" size="sm" onClick={app.clearCopilot}>
            <Eraser size={13} /> Clear conversation
          </Button>
        )}
      </div>

      <div className="flex-1 space-y-4 mb-4">
        {app.copilotMessages.length === 0 && !app.copilotThinking && (
          <Card className="p-6 text-center">
            <BrainCircuit size={26} className="mx-auto mb-3 text-brand-300" />
            <div className="font-bold mb-1">Ask anything about your growth data</div>
            <p className="text-[13px] text-ink-mid mb-5 max-w-md mx-auto leading-relaxed">
              Questions route to specialist agents — performance, cohort quality, monetization, creative, data health, ASO, and trends.
            </p>
            <div className="flex flex-wrap justify-center gap-2 max-w-2xl mx-auto">
              {SUGGESTED_PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => send(p)}
                  className="text-[13px] font-medium bg-surface-2 border border-line hover:border-brand-400/60 hover:text-brand-300 text-ink-mid px-3 py-1.5 rounded-full transition-colors"
                >
                  {p}
                </button>
              ))}
            </div>
          </Card>
        )}

        {app.copilotMessages.map((m) => (
          <div key={m.id} className={clsx('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            {m.role === 'user' ? (
              <div className="max-w-[85%] sm:max-w-[65%] bg-brand-500/20 border border-brand-400/25 rounded-2xl rounded-br-md px-4 py-2.5">
                <p className="text-[13px] leading-relaxed">{m.text}</p>
                <div className="text-2xs text-ink-low mt-1 text-right">{fmtDateTime(m.ts)}</div>
              </div>
            ) : (
              <Card className="max-w-[95%] sm:max-w-[80%] p-4 animate-slide-up">
                {m.answer && (
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="text-2xs font-bold uppercase tracking-wide bg-purple-dim text-purple-400 px-2 py-0.5 rounded-md">{m.answer.agent}</span>
                    <ConfidencePill level={m.answer.confidence} />
                  </div>
                )}
                <p className="text-[13px] leading-relaxed text-ink-hi">{m.text}</p>
                {m.answer && (
                  <>
                    {m.answer.evidence.length > 0 && (
                      <div className="mt-3 space-y-1">
                        <div className="label-2xs">Evidence</div>
                        {m.answer.evidence.map((e, i) => (
                          <div key={i} className="flex items-start justify-between gap-3 bg-surface-2 rounded-lg px-3 py-1.5">
                            <span className="text-xs text-ink-mid min-w-0 truncate" title={e.label}>{e.label}</span>
                            <span className="text-xs num font-semibold text-ink-hi text-right shrink-0">{e.value}</span>
                          </div>
                        ))}
                        <div className="text-2xs text-ink-low pt-0.5">Sources: {[...new Set(m.answer.evidence.map((e) => e.source))].join(' · ')}</div>
                      </div>
                    )}
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <div className="label-2xs mb-0.5">Limitations</div>
                        <p className="text-2xs text-ink-low leading-relaxed">{m.answer.limitations}</p>
                      </div>
                      <div>
                        <div className="label-2xs mb-0.5">Suggested next action</div>
                        <p className="text-2xs text-ink-mid leading-relaxed">{m.answer.next_action}</p>
                      </div>
                    </div>
                  </>
                )}
              </Card>
            )}
          </div>
        ))}

        {app.copilotThinking && (
          <Card className="inline-flex items-center gap-2.5 px-4 py-3 animate-fade-in">
            <span className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span key={i} className="w-1.5 h-1.5 rounded-full bg-brand-300 animate-pulse2" style={{ animationDelay: `${i * 0.25}s` }} />
              ))}
            </span>
            <span className="text-[13px] text-ink-mid">Consulting agents and gathering evidence…</span>
          </Card>
        )}
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <form
        onSubmit={(e) => { e.preventDefault(); send() }}
        className="sticky bottom-3 bg-surface-1 border border-line-strong rounded-2xl shadow-pop p-2 flex items-center gap-2"
      >
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about campaigns, creatives, tracking, monetization…"
          aria-label="Ask the copilot"
          className="flex-1 bg-transparent px-3 py-2 text-[13px] text-ink-hi placeholder:text-ink-low outline-none"
          maxLength={300}
        />
        <Button type="submit" variant="primary" disabled={!input.trim() || app.copilotThinking} title="Send (Enter)">
          <Send size={14} />
          <span className="hidden sm:inline">Ask</span>
        </Button>
      </form>

      {app.copilotMessages.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {SUGGESTED_PROMPTS.slice(0, 4).map((p) => (
            <button
              key={p}
              onClick={() => send(p)}
              disabled={app.copilotThinking}
              className="text-2xs font-medium bg-surface-2 border border-line hover:border-brand-400/60 hover:text-brand-300 text-ink-low px-2.5 py-1 rounded-full transition-colors disabled:opacity-40"
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
