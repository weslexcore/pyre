// The "Ask" island: a chat with the knowledge assistant. Messages fill the
// page above a composer pinned to the bottom, and a sidebar (a drawer on
// phones) lists the staff member's earlier conversations so any of them can
// be reopened and, when the assistant still has it, continued.
//
// Each question opens (or continues) a pyre-agents knowledge session through
// /api/admin/knowledge-ask, then streams the answer as it is written. The
// assistant's interim narration ("let me search…") and every tool call,
// with its input and result, collect into the turn's trail (AskTrail),
// which stays beside the answer so any step can be opened afterwards; the
// final block is the answer. Answers render through SopMarkdown so
// in-library links open the peek modal instead of navigating away
// mid-question; absolute dashboard links are made relative first so they
// qualify.
//
// History comes from the assistant's own audit log, read back for the
// caller by /api/admin/knowledge-history. Reopening a conversation loads its
// questions, answers and trails and a token to continue it; the next
// question then either lands in the same session or, when the assistant has
// let it go, starts a fresh one and says so.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useCachedJson } from '@/lib/client/cachedJson';
import type { ConversationSummary, ConversationTurn } from '@/lib/knowledge/history';
import { MAX_QUESTION_LENGTH } from '@/lib/knowledge/question';
import type { AskStreamEvent } from '@/lib/knowledge/stream';
import {
  type TrailStep,
  trailWithCalls,
  trailWithResult,
  trailWithThought,
} from '@/lib/knowledge/trail';
import { AskHistory } from './AskHistory';
import { AskTrail, liveActivityLabel } from './AskTrail';
import { SopMarkdown } from './SopMarkdown';
import { SopPeekModal } from './SopPeekModal';

interface Turn {
  id: string;
  question: string;
  answer: string;
  /** Streaming text for the block currently being written (may be narration). */
  live: string;
  /** Narration and tool calls so far, in order. */
  trail: TrailStep[];
  /** Whether the trail's steps are shown; live turns open, reopened ones closed. */
  trailOpen: boolean;
  /** 'empty' is a logged question the assistant never answered (cancelled, or lost). */
  status: 'pending' | 'streaming' | 'done' | 'error' | 'empty';
  error?: string;
  /** Set when the previous conversation had expired and this turn started anew. */
  fresh?: boolean;
}

interface AskSession {
  id: string;
  token: string;
  /** Where the next stream read starts; null for a reopened conversation until the ask route says. */
  nextIndex: number | null;
}

interface HistoryPayload {
  conversations: ConversationSummary[];
}

interface ConversationPayload {
  sessionId: string;
  token: string | null;
  turns: ConversationTurn[];
}

const HISTORY_URL = '/api/admin/knowledge-history';

const EXAMPLES = [
  'What are the benefits of cold plunging?',
  'How do I break down the fire and water side at close?',
  'What do we tell a guest who is pregnant and wants to plunge?',
  'When was the left tub last shocked?',
  'When is my next shift, and who am I on with?',
];

/** Past this many lines the composer scrolls instead of growing. */
const COMPOSER_MAX_HEIGHT_PX = 160;

/** Within this many pixels of the bottom counts as "reading the latest". */
const STICK_THRESHOLD_PX = 80;

const smallButtonClass =
  'rounded border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-mono uppercase tracking-wide text-white/70 hover:border-white/30 hover:text-white transition-colors disabled:opacity-40';

/** Dashboard links come back absolute; the peek modal only recognises /admin/sops/… paths. */
export function relativizeDashboardLinks(markdown: string): string {
  return markdown.replace(/https?:\/\/[^\s/()]+\/admin\//g, '/admin/');
}

/** A logged question and answer as a chat turn. Exported for tests. */
export function turnFromHistory(turn: ConversationTurn): Turn {
  const answer = turn.answer ?? '';
  return {
    id: turn.id,
    question: turn.question || '(question not recorded)',
    answer,
    live: '',
    trail: turn.trail,
    trailOpen: false,
    status: answer ? 'done' : turn.status === 'failed' ? 'error' : 'empty',
    error:
      !answer && turn.status === 'failed'
        ? (turn.error ?? 'The assistant hit an error')
        : undefined,
  };
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

interface Props {
  /** Admins get the link to the review log of everyone's questions. */
  isAdmin?: boolean;
}

export function SopAsk({ isAdmin = false }: Props) {
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [openingSessionId, setOpeningSessionId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [peekSlug, setPeekSlug] = useState<string | null>(null);
  const session = useRef<AskSession | null>(null);
  const nextId = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  // Follow the newest text only while the reader is already at the bottom.
  const stickToBottom = useRef(true);

  const history = useCachedJson<HistoryPayload>(HISTORY_URL);
  const conversations = history.data?.conversations ?? [];

  const patchTurn = useCallback(
    (id: string, patch: Partial<Turn> | ((t: Turn) => Partial<Turn>)) => {
      setTurns((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } : t
        )
      );
    },
    []
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever the transcript changes
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
  };

  const resizeComposer = useCallback(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT_PX)}px`;
  }, []);

  // Hand focus back once an answer lands, so a follow-up is one keystroke
  // away — but not on first paint, which would pop the keyboard on a phone.
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy) composerRef.current?.focus({ preventScroll: true });
    wasBusy.current = busy;
  }, [busy]);

  const streamAnswer = useCallback(
    async (turnId: string, current: AskSession) => {
      // The function budget may cut a long answer short; resume from where
      // the proxy said it stopped, a few times at most.
      for (let attempt = 0; attempt < 4; attempt++) {
        const params = new URLSearchParams({
          sessionId: current.id,
          token: current.token,
          startIndex: String(current.nextIndex ?? 0),
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
                // Narration before a tool call joins the trail; the final block is the answer.
                if (event.finishReason === 'stop' || event.finishReason === 'length') {
                  patchTurn(turnId, { answer: event.text, live: '' });
                } else {
                  patchTurn(turnId, (t) => ({
                    live: '',
                    trail: trailWithThought(t.trail, event.text),
                  }));
                }
                break;
              case 'thought':
                patchTurn(turnId, (t) => ({ trail: trailWithThought(t.trail, event.text) }));
                break;
              case 'activity':
                patchTurn(turnId, (t) => ({
                  live: '',
                  trail: trailWithCalls(t.trail, event.calls),
                }));
                break;
              case 'result':
                patchTurn(turnId, (t) => ({ trail: trailWithResult(t.trail, event) }));
                break;
              case 'done':
                outcome = event;
                break;
            }
            if (outcome) break;
          }
          if (done && !outcome)
            outcome = { type: 'done', status: 'timeout', nextIndex: current.nextIndex ?? 0 };
        }

        current.nextIndex = outcome.nextIndex;
        if (outcome.status === 'waiting') {
          patchTurn(turnId, (t) => ({
            status: 'done',
            answer: t.answer || t.live,
            live: '',
          }));
          return;
        }
        if (outcome.status === 'failed') {
          patchTurn(turnId, {
            status: 'error',
            error: outcome.error ?? 'The assistant hit an error',
          });
          return;
        }
        if (outcome.status === 'gone') {
          session.current = null;
          patchTurn(turnId, (t) => ({
            status: t.answer ? 'done' : 'error',
            error: t.answer ? undefined : 'The conversation ended before an answer arrived',
          }));
          return;
        }
        // 'timeout': loop and resume.
      }
      patchTurn(turnId, {
        status: 'error',
        error: 'The answer took too long — try asking again',
      });
    },
    [patchTurn]
  );

  const ask = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busy || openingSessionId) return;
      setBusy(true);
      setNotice(null);
      setQuestion('');
      requestAnimationFrame(resizeComposer);
      stickToBottom.current = true;

      const id = `local-${nextId.current++}`;
      setTurns((prev) => [
        ...prev,
        {
          id,
          question: text,
          answer: '',
          live: '',
          trail: [],
          trailOpen: true,
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
            ...(prior
              ? {
                  session: {
                    id: prior.id,
                    token: prior.token,
                    ...(prior.nextIndex === null ? { resume: true } : {}),
                  },
                }
              : {}),
          }),
        });
        if (!res.ok) throw new Error(await readError(res));
        const body = (await res.json()) as {
          sessionId: string;
          token: string;
          fresh: boolean;
          nextIndex?: number;
        };

        const current: AskSession =
          !body.fresh && prior && prior.id === body.sessionId
            ? { ...prior, nextIndex: prior.nextIndex ?? body.nextIndex ?? 0 }
            : { id: body.sessionId, token: body.token, nextIndex: 0 };
        session.current = current;
        setActiveSessionId(current.id);
        if (prior && body.fresh) patchTurn(id, { fresh: true });

        await streamAnswer(id, current);
      } catch (error) {
        patchTurn(id, {
          status: 'error',
          error: error instanceof Error ? error.message : 'Something went wrong',
        });
      } finally {
        setBusy(false);
        // The agent writes the log row as the turn runs; give it a beat, then
        // refresh the sidebar so this conversation shows up (or moves up).
        setTimeout(() => void history.reload(), 800);
      }
    },
    [busy, openingSessionId, patchTurn, streamAnswer, history.reload, resizeComposer]
  );

  // Arriving from the global search's "Ask a question" row: ?q= is the
  // question, asked once on mount as a new conversation. The param is dropped
  // from the URL first so a reload (or the back button) doesn't ask it again.
  const askedFromUrl = useRef(false);
  useEffect(() => {
    if (askedFromUrl.current) return;
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q')?.trim();
    if (!q) return;
    askedFromUrl.current = true;
    params.delete('q');
    const rest = params.toString();
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`
    );
    void ask(q);
  }, [ask]);

  const startNew = () => {
    if (busy) return;
    session.current = null;
    setTurns([]);
    setActiveSessionId(null);
    setNotice(null);
    setQuestion('');
    setHistoryOpen(false);
    requestAnimationFrame(() => {
      resizeComposer();
      composerRef.current?.focus();
    });
  };

  const openConversation = useCallback(
    async (sessionId: string) => {
      if (busy || openingSessionId) return;
      setHistoryOpen(false);
      if (sessionId === activeSessionId) return;
      setOpeningSessionId(sessionId);
      setNotice(null);
      try {
        const res = await fetch(`${HISTORY_URL}?sessionId=${encodeURIComponent(sessionId)}`);
        if (!res.ok) throw new Error(await readError(res));
        const body = (await res.json()) as ConversationPayload;
        stickToBottom.current = true;
        setTurns(body.turns.map(turnFromHistory));
        session.current = body.token
          ? { id: body.sessionId, token: body.token, nextIndex: null }
          : null;
        setActiveSessionId(body.sessionId);
      } catch (error) {
        setNotice(
          `Could not open that conversation: ${error instanceof Error ? error.message : 'unknown error'}`
        );
      } finally {
        setOpeningSessionId(null);
      }
    },
    [activeSessionId, busy, openingSessionId]
  );

  const historyPanel = (
    <AskHistory
      conversations={conversations}
      activeSessionId={activeSessionId}
      openingSessionId={openingSessionId}
      loading={history.loading}
      error={history.error}
      busy={busy}
      onSelect={(id) => void openConversation(id)}
      onNew={startNew}
      isAdmin={isAdmin}
    />
  );

  const canSend = !busy && !openingSessionId && question.trim().length > 0;

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <aside className="hidden w-64 shrink-0 flex-col rounded border border-white/10 bg-white/[0.03] md:flex">
        {historyPanel}
      </aside>

      {historyOpen && (
        <div
          className="fixed inset-0 z-50 md:hidden"
          role="dialog"
          aria-label="Previous conversations"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            aria-label="Close history"
            onClick={() => setHistoryOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-80 max-w-[85vw] flex-col border-r border-white/10 bg-[var(--pyre-black)] shadow-lg">
            <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-3 py-2">
              <span className="font-mono text-xs uppercase tracking-wide text-white/60">
                Conversations
              </span>
              <button
                type="button"
                className={smallButtonClass}
                onClick={() => setHistoryOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="min-h-0 flex-1">{historyPanel}</div>
          </div>
        </div>
      )}

      <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded border border-white/10 bg-white/[0.03]">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3 py-2 md:hidden">
          <button
            type="button"
            className={smallButtonClass}
            onClick={() => setHistoryOpen(true)}
            disabled={busy}
          >
            History{conversations.length > 0 ? ` (${conversations.length})` : ''}
          </button>
          <button
            type="button"
            className={smallButtonClass}
            onClick={startNew}
            disabled={busy || (turns.length === 0 && activeSessionId === null)}
          >
            New chat
          </button>
        </div>

        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5"
        >
          {notice && (
            <p className="mb-4 rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 px-3 py-2 text-sm text-[var(--pyre-red)]">
              {notice}
            </p>
          )}

          {turns.length === 0 ? (
            <div className="flex h-full flex-col justify-center">
              <div className="mx-auto w-full max-w-2xl">
                <p className="mb-4 text-center text-sm text-white/60">
                  Ask anything about how we run the sauna, or about your shifts. Answers come only
                  from the SOPs, shift notes, water log, incident reports, and schedule you can see,
                  with links to where they come from.
                </p>
                <h2 className="mb-2 text-center font-mono text-xs uppercase tracking-wide text-[var(--pyre-gold)]">
                  Try asking
                </h2>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {EXAMPLES.map((example) => (
                    <li key={example}>
                      <button
                        type="button"
                        className="w-full rounded border border-white/10 bg-white/5 px-4 py-3 text-left text-sm text-[var(--pyre-creme)] transition-colors hover:border-white/30 disabled:opacity-40"
                        disabled={busy || openingSessionId !== null}
                        onClick={() => void ask(example)}
                      >
                        {example}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <ol className="mx-auto max-w-3xl space-y-5">
              {turns.map((turn) => (
                <li key={turn.id} className="space-y-3">
                  <div className="flex justify-end">
                    <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm border border-[var(--pyre-gold)]/40 bg-[var(--pyre-gold)]/10 px-4 py-2 text-sm text-[var(--pyre-creme)]">
                      {turn.question}
                    </p>
                  </div>
                  <div className="flex justify-start">
                    <div className="max-w-[95%] rounded-2xl rounded-bl-sm border border-white/10 bg-white/5 px-4 py-3">
                      {turn.fresh && (
                        <p className="mb-2 text-xs text-white/40">
                          The earlier conversation had expired, so this answer starts fresh.
                        </p>
                      )}
                      <AskTrail
                        steps={turn.trail}
                        live={turn.status === 'pending' || turn.status === 'streaming'}
                        open={turn.trailOpen}
                        onToggle={() => patchTurn(turn.id, (t) => ({ trailOpen: !t.trailOpen }))}
                      />
                      {turn.status === 'error' ? (
                        <p className="text-sm text-[var(--pyre-red)]">{turn.error}</p>
                      ) : turn.status === 'empty' ? (
                        <p className="text-sm text-white/40">No answer was recorded.</p>
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
                          {liveActivityLabel(turn.trail)}…
                        </p>
                      )}
                      {turn.status === 'streaming' && turn.answer === '' && turn.live !== '' && (
                        <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-white/40">
                          Writing…
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        <form
          className="shrink-0 border-t border-white/10 px-3 py-3 sm:px-5"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(question);
          }}
        >
          <div className="mx-auto max-w-3xl">
            <label htmlFor="ask-question" className="sr-only">
              Your question
            </label>
            <div className="flex items-end gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 transition-colors focus-within:border-white/30">
              <textarea
                id="ask-question"
                ref={composerRef}
                className="max-h-40 min-h-[1.5rem] flex-1 resize-none bg-transparent text-sm leading-6 text-[var(--pyre-creme)] placeholder-white/30 focus:outline-none"
                rows={1}
                placeholder={
                  turns.length > 0 ? 'Ask a follow-up…' : 'Ask anything about how we run the sauna…'
                }
                value={question}
                maxLength={MAX_QUESTION_LENGTH}
                disabled={openingSessionId !== null}
                onChange={(e) => {
                  setQuestion(e.target.value);
                  resizeComposer();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void ask(question);
                  }
                }}
              />
              <button
                type="submit"
                className="shrink-0 rounded-lg border border-[var(--pyre-gold)]/50 bg-[var(--pyre-gold)]/10 px-3 py-1.5 text-xs font-mono uppercase tracking-wide text-[var(--pyre-gold)] transition-colors hover:border-[var(--pyre-gold)] disabled:opacity-40"
                disabled={!canSend}
              >
                {busy ? 'Answering…' : 'Send'}
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-white/35">
              Enter sends, Shift+Enter for a new line. Answers come only from the knowledge base and
              link to their sources.
            </p>
          </div>
        </form>
      </section>

      {peekSlug && <SopPeekModal slug={peekSlug} onClose={() => setPeekSlug(null)} />}
    </div>
  );
}
