// The "Ask" island: a question box over the knowledge base. Each question
// opens (or continues) a pyre-agents knowledge session through
// /api/admin/knowledge-ask, then streams the answer as it is written. The
// assistant's interim narration ("let me search…") is folded into a short
// activity line; only its final answer is kept. Answers render through
// SopMarkdown so in-library links open the peek modal instead of navigating
// away mid-question; absolute dashboard links are made relative first so
// they qualify.

import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_QUESTION_LENGTH } from '@/lib/knowledge/question';
import type { AskStreamEvent } from '@/lib/knowledge/stream';
import { SopMarkdown } from './SopMarkdown';
import { SopPeekModal } from './SopPeekModal';

interface Turn {
  id: number;
  question: string;
  answer: string;
  /** Streaming text for the block currently being written (may be narration). */
  live: string;
  activity: string | null;
  status: 'pending' | 'streaming' | 'done' | 'error';
  error?: string;
  /** Set when the previous conversation had expired and this turn started anew. */
  fresh?: boolean;
}

interface AskSession {
  id: string;
  token: string;
  nextIndex: number;
}

const ACTIVITY_LABELS: Record<string, string> = {
  search_knowledge_base: 'Searching the knowledge base',
  list_sops: 'Browsing the library',
  read_sop: 'Reading a document',
  get_water_log: 'Reading the water log',
  get_shift_notes: 'Reading shift notes',
  read_incident: 'Reading an incident report',
};

const EXAMPLES = [
  'What are the benefits of cold plunging?',
  'How do I break down the fire and water side at close?',
  'What do we tell a guest who is pregnant and wants to plunge?',
  'When was the left tub last shocked?',
];

const inputClass =
  'px-3 py-2 rounded bg-white/5 border border-white/10 text-sm text-[var(--pyre-creme)] placeholder-white/30 focus:outline-none focus:border-white/30';

const buttonClass =
  'px-3 py-2 rounded border border-[var(--pyre-gold)]/50 bg-[var(--pyre-gold)]/10 text-xs font-mono uppercase tracking-wide text-[var(--pyre-gold)] hover:border-[var(--pyre-gold)] transition-colors disabled:opacity-40';

/** Dashboard links come back absolute; the peek modal only recognises /admin/sops/… paths. */
export function relativizeDashboardLinks(markdown: string): string {
  return markdown.replace(/https?:\/\/[^\s/()]+\/admin\//g, '/admin/');
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export function SopAsk() {
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [peekSlug, setPeekSlug] = useState<string | null>(null);
  const session = useRef<AskSession | null>(null);
  const nextId = useRef(1);
  const bottomRef = useRef<HTMLDivElement>(null);

  const patchTurn = useCallback(
    (id: number, patch: Partial<Turn> | ((t: Turn) => Partial<Turn>)) => {
      setTurns((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } : t
        )
      );
    },
    []
  );

  // Keep the newest exchange in view while it streams.
  const lastStatus = turns[turns.length - 1]?.status;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on every status change of the newest turn
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns.length, lastStatus]);

  const streamAnswer = useCallback(
    async (turnId: number, current: AskSession) => {
      // The function budget may cut a long answer short; resume from where
      // the proxy said it stopped, a few times at most.
      for (let attempt = 0; attempt < 4; attempt++) {
        const params = new URLSearchParams({
          sessionId: current.id,
          token: current.token,
          startIndex: String(current.nextIndex),
        });
        const res = await fetch(`/api/admin/knowledge-ask?${params}`, {
          headers: { Accept: 'application/x-ndjson' },
        });
        if (!res.ok || !res.body) throw new Error(await readError(res));

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let outcome: Extract<AskStreamEvent, { type: 'done' }> | null = null;

        while (!outcome) {
          const { value, done } = await reader.read();
          if (value) buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.trim()) continue;
            let event: AskStreamEvent;
            try {
              event = JSON.parse(line) as AskStreamEvent;
            } catch {
              continue;
            }
            switch (event.type) {
              case 'delta':
                patchTurn(turnId, { live: event.text, status: 'streaming' });
                break;
              case 'message':
                // Narration before a tool call is dropped; the final block is the answer.
                if (event.finishReason === 'stop' || event.finishReason === 'length') {
                  patchTurn(turnId, { answer: event.text, live: '', activity: null });
                } else {
                  patchTurn(turnId, { live: '' });
                }
                break;
              case 'activity':
                patchTurn(turnId, {
                  activity: ACTIVITY_LABELS[event.tools[0]] ?? 'Working',
                  live: '',
                });
                break;
              case 'done':
                outcome = event;
                break;
            }
            if (outcome) break;
          }
          if (done && !outcome)
            outcome = { type: 'done', status: 'timeout', nextIndex: current.nextIndex };
        }

        current.nextIndex = outcome.nextIndex;
        if (outcome.status === 'waiting') {
          patchTurn(turnId, (t) => ({
            status: 'done',
            activity: null,
            answer: t.answer || t.live,
            live: '',
          }));
          return;
        }
        if (outcome.status === 'failed') {
          patchTurn(turnId, {
            status: 'error',
            error: outcome.error ?? 'The assistant hit an error',
            activity: null,
          });
          return;
        }
        if (outcome.status === 'gone') {
          session.current = null;
          patchTurn(turnId, (t) => ({
            status: t.answer ? 'done' : 'error',
            error: t.answer ? undefined : 'The conversation ended before an answer arrived',
            activity: null,
          }));
          return;
        }
        // 'timeout': loop and resume.
      }
      patchTurn(turnId, {
        status: 'error',
        error: 'The answer took too long — try asking again',
        activity: null,
      });
    },
    [patchTurn]
  );

  const ask = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busy) return;
      setBusy(true);
      setQuestion('');

      const id = nextId.current++;
      setTurns((prev) => [
        ...prev,
        {
          id,
          question: text,
          answer: '',
          live: '',
          activity: 'Searching the knowledge base',
          status: 'pending',
        },
      ]);

      try {
        const prior = session.current;
        const res = await fetch('/api/admin/knowledge-ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: text,
            ...(prior ? { session: { id: prior.id, token: prior.token } } : {}),
          }),
        });
        if (!res.ok) throw new Error(await readError(res));
        const body = (await res.json()) as { sessionId: string; token: string; fresh: boolean };

        const current: AskSession =
          !body.fresh && prior && prior.id === body.sessionId
            ? prior
            : { id: body.sessionId, token: body.token, nextIndex: 0 };
        session.current = current;
        if (prior && body.fresh) patchTurn(id, { fresh: true });

        await streamAnswer(id, current);
      } catch (error) {
        patchTurn(id, {
          status: 'error',
          error: error instanceof Error ? error.message : 'Something went wrong',
          activity: null,
        });
      } finally {
        setBusy(false);
      }
    },
    [busy, patchTurn, streamAnswer]
  );

  const startOver = () => {
    session.current = null;
    setTurns([]);
    setQuestion('');
  };

  return (
    <div className="space-y-6">
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <label htmlFor="ask-question" className="sr-only">
          Your question
        </label>
        <textarea
          id="ask-question"
          className={`${inputClass} w-full resize-none`}
          rows={2}
          placeholder={
            turns.length > 0 ? 'Ask a follow-up…' : 'Ask anything about how we run the sauna…'
          }
          value={question}
          maxLength={MAX_QUESTION_LENGTH}
          disabled={busy}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void ask(question);
            }
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className={buttonClass} disabled={busy || !question.trim()}>
            {busy ? 'Answering…' : 'Ask'}
          </button>
          {turns.length > 0 && (
            <button
              type="button"
              className="px-3 py-2 rounded border border-white/10 bg-white/5 text-xs font-mono uppercase tracking-wide text-white/70 hover:border-white/30 hover:text-white transition-colors disabled:opacity-40"
              disabled={busy}
              onClick={startOver}
            >
              New question
            </button>
          )}
          <span className="text-xs text-white/40">
            Answers come only from the knowledge base and link to their sources. Enter sends,
            Shift+Enter for a new line.
          </span>
        </div>
      </form>

      {turns.length === 0 && (
        <section>
          <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-[var(--pyre-gold)]">
            Try asking
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {EXAMPLES.map((example) => (
              <li key={example}>
                <button
                  type="button"
                  className="w-full rounded border border-white/10 bg-white/5 px-4 py-3 text-left text-sm text-[var(--pyre-creme)] transition-colors hover:border-white/30"
                  onClick={() => void ask(example)}
                >
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ol className="space-y-6">
        {turns.map((turn) => (
          <li key={turn.id} className="space-y-3">
            <div className="flex justify-end">
              <p className="max-w-[85%] whitespace-pre-wrap rounded border border-[var(--pyre-gold)]/40 bg-[var(--pyre-gold)]/10 px-4 py-2 text-sm text-[var(--pyre-creme)]">
                {turn.question}
              </p>
            </div>
            <div className="rounded border border-white/10 bg-white/5 px-4 py-3">
              {turn.fresh && (
                <p className="mb-2 text-xs text-white/40">
                  The earlier conversation had expired, so this answer starts fresh.
                </p>
              )}
              {turn.status === 'error' ? (
                <p className="text-sm text-[var(--pyre-red)]">{turn.error}</p>
              ) : turn.answer ? (
                <div className="text-sm">
                  <SopMarkdown
                    content={relativizeDashboardLinks(turn.answer)}
                    onSopLink={setPeekSlug}
                  />
                </div>
              ) : turn.live ? (
                <div className="text-sm">
                  <SopMarkdown
                    content={relativizeDashboardLinks(turn.live)}
                    onSopLink={setPeekSlug}
                  />
                </div>
              ) : (
                <p className="font-mono text-xs uppercase tracking-wide text-white/50">
                  {turn.activity ?? 'Thinking'}…
                </p>
              )}
              {turn.status === 'streaming' && turn.answer === '' && turn.live !== '' && (
                <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-white/40">
                  Writing…
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
      <div ref={bottomRef} />

      {peekSlug && <SopPeekModal slug={peekSlug} onClose={() => setPeekSlug(null)} />}
    </div>
  );
}
