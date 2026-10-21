// The Pyre Agent island: a chat with the team's assistant. Messages fill the
// page above a composer pinned to the bottom, and a sidebar (a drawer on
// phones) lists the staff member's earlier conversations so any of them can
// be reopened and, when the assistant still has it, continued.
//
// The conversation outlives the page. The agent runs server-side, so leaving
// mid-answer loses nothing; the island remembers which conversation is open
// (?c= in the URL, and localStorage for coming back through the nav) and, on
// the way back in, reopens it from the history and — when its last question
// is still being answered — reattaches to the live answer, replayed from the
// start of that turn (the ask route's resume mode).
//
// For people with boards the agent also reads the goals and boards and
// proposes changes to them. Each proposal is drawn under the answer that
// made it (AgentActions) with Apply and Dismiss; nothing changes on a board
// until the person applies it (/api/admin/agent-actions).
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
import { ErrorBanner } from '@/components/admin/ErrorBanner';
import { readError } from '@/lib/client/api';
import { useCachedJson } from '@/lib/client/cachedJson';
import type {
  ConversationSummary,
  ConversationTurn,
  RoutineRunOrigin,
} from '@/lib/knowledge/history';
import { MAX_QUESTION_LENGTH } from '@/lib/knowledge/question';
import type { AskStreamEvent } from '@/lib/knowledge/stream';
import {
  type TrailStep,
  trailWithCalls,
  trailWithResult,
  trailWithThought,
} from '@/lib/knowledge/trail';
import {
  CONVERSATION_PARAM,
  readStored,
  type StoredConversation,
  writeStored,
} from '@/lib/pyre-agent/conversation';
import { type ActionView, isProposeTool, proposalIdOf } from '@/lib/pyre-agent/types';
import { AgentActions } from './AgentActions';
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
  /** Set when the session had ended and the conversation could not be carried over. */
  fresh?: boolean;
  /**
   * Set on the first question a new session took after the conversation's
   * earlier session ended: it was handed everything above and carried on.
   */
  continued?: boolean;
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
  /** The live session: the newest one the conversation runs in. */
  sessionId: string;
  /** The conversation (its first session) — what the sidebar and ?c= name. */
  conversationId?: string;
  token: string | null;
  turns: ConversationTurn[];
  /** Set when a saved routine opened this conversation. */
  routine: RoutineRunOrigin | null;
}

/** "Mon, Oct 20, 8:00 AM" on the studio's clock. */
function formatRanAt(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * The top of a conversation a routine opened: which routine, when it ran and
 * whether on its schedule or by hand, and a way to the routine itself — so
 * an answer nobody typed a question for says where it came from.
 */
export function RoutineBanner({ routine }: { routine: RoutineRunOrigin }) {
  const how =
    routine.trigger === 'scheduled'
      ? `Ran on its schedule ${formatRanAt(routine.ranAt)}`
      : `Run by hand ${formatRanAt(routine.ranAt)}`;
  return (
    <div className="mx-auto mb-5 max-w-3xl rounded-lg border border-dashed border-[var(--pyre-gold)]/40 bg-[var(--pyre-gold)]/5 px-4 py-3">
      <p className="font-mono text-[10px] uppercase tracking-wide text-[var(--pyre-gold)]">
        Routine
      </p>
      <p className="mt-0.5 text-sm text-[var(--pyre-creme)]">{routine.title}</p>
      <p className="mt-1 text-xs text-white/55">
        {how}
        {routine.schedule
          ? ` · ${routine.schedule}${routine.enabled ? '' : ' (paused)'}`
          : ' · this routine has since been deleted'}
        . Nobody typed this request; Pyre Agent ran it for you. Follow-ups here are yours.
      </p>
      {routine.routineId && (
        <a
          href="/admin/ask/routines"
          className="mt-2 inline-block font-mono text-[10px] uppercase tracking-wide text-[var(--pyre-gold)] hover:underline"
        >
          Manage routine →
        </a>
      )}
    </div>
  );
}

const HISTORY_URL = '/api/admin/knowledge-history';
const ACTIONS_URL = '/api/admin/agent-actions';

/** Put the open conversation in the URL (or take it out) without a navigation. */
function writeConversationParam(sessionId: string | null): void {
  const url = new URL(window.location.href);
  if (sessionId) url.searchParams.set(CONVERSATION_PARAM, sessionId);
  else url.searchParams.delete(CONVERSATION_PARAM);
  if (url.href !== window.location.href) {
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }
}

/** Whether the log's copy of a question is the one this browser sent (the log tidies it). */
function sameQuestion(logged: string, sent: string): boolean {
  const tidy = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 500);
  return tidy(logged) === tidy(sent);
}

/** The proposal ids a turn's trail made, in order. Exported for tests. */
export function proposalIdsOf(trail: TrailStep[]): string[] {
  const ids: string[] = [];
  for (const step of trail) {
    if (step.kind !== 'tool' || !isProposeTool(step.tool) || step.status !== 'completed') continue;
    const id = proposalIdOf(step.output);
    if (id) ids.push(id);
  }
  return ids;
}

const EXAMPLES = [
  'What are the benefits of cold plunging?',
  'How do I break down the fire and water side at close?',
  'When was the left tub last shocked?',
  'When is my next shift, and who am I on with?',
];

/** Offered to people who can see goals and boards. */
const BOARD_EXAMPLES = [
  'Give me a status update on our goals',
  'What is overdue, and what is on my plate this week?',
  'Help me break our next goal into tasks',
  'Propose a board for tracking wholesale leads',
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
    ...(turn.continuesConversation ? { continued: true } : {}),
    error:
      !answer && turn.status === 'failed'
        ? (turn.error ?? 'The assistant hit an error')
        : undefined,
  };
}

interface Props {
  /** Admins get the link to the review log of everyone's questions. */
  isAdmin?: boolean;
  /** Whether this person can see goals and boards (their examples and copy). */
  hasBoards?: boolean;
}

export function SopAsk({ isAdmin = false, hasBoards = false }: Props) {
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  /** The conversation on screen (its first session's id), as the sidebar and ?c= name it. */
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  // The same, for callbacks that must not wait for a render. The live session
  // (session.current) differs from it once a conversation outlived its
  // first session and carried on in a new one.
  const conversationRef = useRef<string | null>(null);
  const [openingSessionId, setOpeningSessionId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [peekSlug, setPeekSlug] = useState<string | null>(null);
  const [actions, setActions] = useState<ActionView[]>([]);
  const [workingActionId, setWorkingActionId] = useState<string | null>(null);
  /** The routine that opened the conversation on screen, if one did. */
  const [routine, setRoutine] = useState<RoutineRunOrigin | null>(null);
  const [routineRequestOpen, setRoutineRequestOpen] = useState(false);
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

  // The open conversation's proposals; a stale reply for a conversation the
  // person has since left is dropped.
  const actionsFor = useRef<string | null>(null);
  const refreshActions = useCallback(async (sessionId: string) => {
    actionsFor.current = sessionId;
    try {
      const res = await fetch(`${ACTIONS_URL}?sessionId=${encodeURIComponent(sessionId)}`);
      if (!res.ok) return;
      const body = (await res.json()) as { actions: ActionView[] };
      if (actionsFor.current === sessionId) setActions(body.actions);
    } catch {
      // The cards catch up on the next refresh.
    }
  }, []);

  const decideAction = useCallback(async (id: string, action: 'apply' | 'dismiss') => {
    setWorkingActionId(id);
    try {
      const res = await fetch(ACTIONS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      });
      const body = (await res.json().catch(() => ({}))) as { action?: ActionView; error?: string };
      const updated = body.action;
      if (updated) {
        setActions((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      } else {
        setActions((prev) =>
          prev.map((a) => (a.id === id ? { ...a, error: body.error ?? 'Something went wrong' } : a))
        );
      }
    } catch (error) {
      setActions((prev) =>
        prev.map((a) =>
          a.id === id
            ? { ...a, error: error instanceof Error ? error.message : 'Something went wrong' }
            : a
        )
      );
    } finally {
      setWorkingActionId(null);
    }
  }, []);

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
    async (turnId: string, current: AskSession, options: { resume?: boolean } = {}) => {
      // The function budget may cut a long answer short; resume from where
      // the proxy said it stopped, a few times at most. Reattaching to a
      // conversation (options.resume) has no position yet: the first read
      // replays its newest turn from the start, and says where it got to.
      for (let attempt = 0; attempt < 4; attempt++) {
        const reattach = options.resume === true && attempt === 0;
        const params = new URLSearchParams({
          sessionId: current.id,
          token: current.token,
          ...(reattach ? { resume: '1' } : { startIndex: String(current.nextIndex ?? 0) }),
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
                // A proposal just landed: draw its card now, not after the answer.
                if (proposalIdOf(event.output)) {
                  void refreshActions(conversationRef.current ?? current.id);
                }
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
    [patchTurn, refreshActions]
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
          conversationId?: string;
          token: string;
          fresh: boolean;
          /** How many earlier questions a new session was handed, when it carried the conversation. */
          carried?: number;
          nextIndex?: number;
        };

        const current: AskSession =
          !body.fresh && prior && prior.id === body.sessionId
            ? { ...prior, nextIndex: prior.nextIndex ?? body.nextIndex ?? 0 }
            : { id: body.sessionId, token: body.token, nextIndex: 0 };
        session.current = current;
        // A new session that carried the conversation is still the same
        // conversation: same sidebar row, same proposals, same routine.
        const conversationId = body.conversationId ?? body.sessionId;
        const sameConversation = conversationRef.current === conversationId;
        conversationRef.current = conversationId;
        setActiveSessionId(conversationId);
        if (!sameConversation) {
          actionsFor.current = conversationId;
          setActions([]);
          setRoutine(null);
        }
        if (prior && body.fresh) {
          patchTurn(id, body.carried ? { continued: true } : { fresh: true });
        }
        // Remember it before the answer arrives: leaving now and coming back
        // reopens this conversation and picks the answer up where it is.
        writeStored({ sessionId: current.id, conversationId, token: current.token, pending: text });
        writeConversationParam(conversationId);

        await streamAnswer(id, current);
        writeStored({ sessionId: current.id, conversationId, token: current.token });
        void refreshActions(conversationId);
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
    [
      busy,
      openingSessionId,
      patchTurn,
      streamAnswer,
      history.reload,
      resizeComposer,
      refreshActions,
    ]
  );

  // Arriving from the global search's "Ask Pyre Agent" row: ?q= is the
  // question, asked once on mount as a new conversation. The param is dropped
  // from the URL first so a reload (or the back button) doesn't ask it again.
  const askedFromUrl = useRef(false);
  // The URL as the page opened, before the ?q= handling below rewrites it —
  // the restore further down must not reopen an old conversation over it.
  const initialSearch = useRef(typeof window === 'undefined' ? '' : window.location.search);
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
    conversationRef.current = null;
    setTurns([]);
    setActiveSessionId(null);
    actionsFor.current = null;
    setActions([]);
    setRoutine(null);
    setNotice(null);
    setQuestion('');
    setHistoryOpen(false);
    writeStored(null);
    writeConversationParam(null);
    requestAnimationFrame(() => {
      resizeComposer();
      composerRef.current?.focus();
    });
  };

  /**
   * Show a conversation from the history and, when its last question is
   * still being answered, reattach to the answer. `stored` is what this
   * browser remembered of it — a question sent just before leaving may not
   * be in the history yet, and the token lets the island stream it anyway.
   * Quiet (no notice) when restoring on load: a conversation that has gone
   * just leaves the page empty.
   */
  const loadConversation = useCallback(
    async (
      sessionId: string,
      opts: { stored?: StoredConversation | null; quiet?: boolean } = {}
    ) => {
      setOpeningSessionId(sessionId);
      setNotice(null);
      let reattach: { turnId: string; current: AskSession } | null = null;
      let token: string | null = null;
      // The live session and the conversation it belongs to; they differ
      // once a conversation carried on after its first session ended.
      let live = sessionId;
      let conversationId = sessionId;
      try {
        const res = await fetch(`${HISTORY_URL}?sessionId=${encodeURIComponent(sessionId)}`);
        const stored =
          opts.stored &&
          (opts.stored.sessionId === sessionId || opts.stored.conversationId === sessionId)
            ? opts.stored
            : null;
        if (res.status === 404 && stored?.pending) {
          // Sent, but not logged yet: show the question and stream its answer.
          const turnId = `local-${nextId.current++}`;
          setTurns([
            {
              id: turnId,
              question: stored.pending,
              answer: '',
              live: '',
              trail: [],
              trailOpen: true,
              status: 'pending',
            },
          ]);
          token = stored.token;
          live = stored.sessionId;
          conversationId = stored.conversationId ?? stored.sessionId;
          reattach = { turnId, current: { id: live, token, nextIndex: null } };
          setRoutine(null);
        } else {
          if (!res.ok) throw new Error(await readError(res));
          const body = (await res.json()) as ConversationPayload;
          live = body.sessionId;
          conversationId = body.conversationId ?? body.sessionId;
          token = body.token ?? stored?.token ?? null;
          const loaded = body.turns.map(turnFromHistory);
          const last = body.turns[body.turns.length - 1];
          setRoutine(body.routine ?? null);
          setRoutineRequestOpen(false);
          const opening = stored?.pending ?? body.routine?.prompt ?? body.routine?.title;
          if (token && loaded.length === 0 && opening) {
            // A routine run (or a question) that has started but is not
            // logged yet: show its request and stream the answer in.
            const turnId = `local-${nextId.current++}`;
            loaded.push({
              id: turnId,
              question: opening,
              answer: '',
              live: '',
              trail: [],
              trailOpen: true,
              status: 'pending',
            });
            reattach = { turnId, current: { id: body.sessionId, token, nextIndex: null } };
          } else if (token && last?.status === 'pending' && !last.answer) {
            // Still being answered (or never finished): replay it live.
            const turnId = loaded[loaded.length - 1].id;
            loaded[loaded.length - 1] = {
              ...loaded[loaded.length - 1],
              trail: [],
              trailOpen: true,
              status: 'pending',
            };
            reattach = {
              turnId,
              current: { id: body.sessionId, token, nextIndex: null },
            };
          } else if (
            token &&
            stored?.pending &&
            last &&
            !sameQuestion(last.question, stored.pending)
          ) {
            // A follow-up sent just before leaving, not in the log yet: show
            // it and stream its answer (by now its turn is the newest).
            const turnId = `local-${nextId.current++}`;
            loaded.push({
              id: turnId,
              question: stored.pending,
              answer: '',
              live: '',
              trail: [],
              trailOpen: true,
              status: 'pending',
            });
            reattach = { turnId, current: { id: body.sessionId, token, nextIndex: null } };
          }
          setTurns(loaded);
        }
        stickToBottom.current = true;
        session.current = token ? { id: live, token, nextIndex: null } : null;
        conversationRef.current = conversationId;
        setActiveSessionId(conversationId);
        actionsFor.current = conversationId;
        setActions([]);
        void refreshActions(conversationId);
        if (token) {
          const pending = reattach ? opts.stored?.pending : undefined;
          writeStored({
            sessionId: live,
            conversationId,
            token,
            ...(pending ? { pending } : {}),
          });
        }
        writeConversationParam(conversationId);
      } catch (error) {
        if (opts.quiet) {
          writeStored(null);
          writeConversationParam(null);
        } else {
          setNotice(
            `Could not open that conversation: ${error instanceof Error ? error.message : 'unknown error'}`
          );
        }
      } finally {
        setOpeningSessionId(null);
      }

      if (!reattach) return;
      setBusy(true);
      try {
        session.current = reattach.current;
        await streamAnswer(reattach.turnId, reattach.current, { resume: true });
        writeStored({
          sessionId: reattach.current.id,
          conversationId,
          token: reattach.current.token,
        });
        void refreshActions(conversationId);
      } catch (error) {
        patchTurn(reattach.turnId, {
          status: 'error',
          error: error instanceof Error ? error.message : 'Could not reconnect to the answer',
        });
      } finally {
        setBusy(false);
        setTimeout(() => void history.reload(), 800);
      }
    },
    [patchTurn, refreshActions, streamAnswer, history.reload]
  );

  const openConversation = useCallback(
    async (sessionId: string) => {
      if (busy || openingSessionId) return;
      setHistoryOpen(false);
      if (sessionId === activeSessionId) return;
      await loadConversation(sessionId);
    },
    [activeSessionId, busy, openingSessionId, loadConversation]
  );

  // Coming back: reopen the conversation in the URL, else the one this
  // browser had open. A ?q= question (handled above) starts a new one instead.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const params = new URLSearchParams(initialSearch.current);
    if (params.get('q')?.trim()) return;
    const stored = readStored();
    const sessionId =
      params.get(CONVERSATION_PARAM)?.trim() || stored?.conversationId || stored?.sessionId;
    if (sessionId) void loadConversation(sessionId, { stored, quiet: true });
  }, [loadConversation]);

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

  // Each proposal sits under the answer whose trail made it; any the trails
  // do not account for (a trail cut short) go under the last answer.
  const actionsByTurn = new Map<string, ActionView[]>();
  const placed = new Set<string>();
  for (const turn of turns) {
    const ids = proposalIdsOf(turn.trail);
    const mine = actions.filter((a) => ids.includes(a.id));
    for (const a of mine) placed.add(a.id);
    actionsByTurn.set(turn.id, mine);
  }
  const lastTurn = turns[turns.length - 1];
  if (lastTurn && lastTurn.status !== 'pending' && lastTurn.status !== 'streaming') {
    const unplaced = actions.filter((a) => !placed.has(a.id));
    if (unplaced.length > 0) {
      actionsByTurn.set(lastTurn.id, [...(actionsByTurn.get(lastTurn.id) ?? []), ...unplaced]);
    }
  }
  const examples = hasBoards ? [...BOARD_EXAMPLES, ...EXAMPLES.slice(0, 2)] : EXAMPLES;

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
          {notice && <ErrorBanner className="mb-4">{notice}</ErrorBanner>}

          {turns.length === 0 ? (
            <div className="flex h-full flex-col justify-center">
              <div className="mx-auto w-full max-w-2xl">
                <p className="mb-4 text-center text-sm text-white/60">
                  {hasBoards
                    ? 'Ask about how we run the sauna, your shifts, or where our goals stand. Pyre Agent answers from what you can see, with links to where it comes from, and proposes board changes for you to apply.'
                    : 'Ask anything about how we run the sauna, or about your shifts. Answers come only from the SOPs, shift notes, water log, incident reports, and schedule you can see, with links to where they come from.'}
                </p>
                <h2 className="mb-2 text-center font-mono text-xs uppercase tracking-wide text-[var(--pyre-gold)]">
                  Try asking
                </h2>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {examples.map((example) => (
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
            <>
              {routine && <RoutineBanner routine={routine} />}
              <ol className="mx-auto max-w-3xl space-y-5">
                {turns.map((turn, index) => (
                  <li key={turn.id} className="space-y-3">
                    {turn.continued && (
                      <p className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-wide text-white/35">
                        <span className="h-px flex-1 bg-white/10" />
                        Session ended — picked back up with everything above
                        <span className="h-px flex-1 bg-white/10" />
                      </p>
                    )}
                    <div className="flex flex-col items-end">
                      {routine && index === 0 ? (
                        // The routine's saved request, not something the person
                        // typed: drawn apart from their own messages, and folded
                        // to a few lines since it is often long.
                        <div className="max-w-[85%] rounded-2xl rounded-br-sm border border-dashed border-[var(--pyre-gold)]/40 bg-white/[0.03] px-4 py-2">
                          <p className="font-mono text-[10px] uppercase tracking-wide text-[var(--pyre-gold)]/80">
                            Routine request · {routine.title}
                          </p>
                          <p
                            className={`mt-1 whitespace-pre-wrap text-sm text-white/70 ${routineRequestOpen ? '' : 'line-clamp-3'}`}
                          >
                            {turn.question}
                          </p>
                          <button
                            type="button"
                            className="mt-1 font-mono text-[10px] uppercase tracking-wide text-white/40 hover:text-white"
                            onClick={() => setRoutineRequestOpen((open) => !open)}
                          >
                            {routineRequestOpen ? 'Show less' : 'Show the whole request'}
                          </button>
                        </div>
                      ) : (
                        <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm border border-[var(--pyre-gold)]/40 bg-[var(--pyre-gold)]/10 px-4 py-2 text-sm text-[var(--pyre-creme)]">
                          {turn.question}
                        </p>
                      )}
                      {turn.status === 'done' && !(routine && index === 0) && (
                        <a
                          href={`/admin/ask/routines?prompt=${encodeURIComponent(turn.question)}`}
                          className="mt-1 font-mono text-[10px] uppercase tracking-wide text-white/30 hover:text-[var(--pyre-gold)]"
                        >
                          Save as routine
                        </a>
                      )}
                    </div>
                    <div className="flex justify-start">
                      <div className="max-w-[95%] rounded-2xl rounded-bl-sm border border-white/10 bg-white/5 px-4 py-3">
                        {turn.fresh && (
                          <p className="mb-2 text-xs text-white/40">
                            The earlier session had ended and the conversation could not be carried
                            over, so this answer starts fresh.
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
                        <AgentActions
                          actions={actionsByTurn.get(turn.id) ?? []}
                          workingId={workingActionId}
                          onApply={(id) => void decideAction(id, 'apply')}
                          onDismiss={(id) => void decideAction(id, 'dismiss')}
                        />
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </>
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
                  turns.length > 0
                    ? 'Ask a follow-up…'
                    : hasBoards
                      ? 'Ask about the sauna, your shifts, or our goals…'
                      : 'Ask anything about how we run the sauna…'
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
              Enter sends, Shift+Enter for a new line. Answers link to their sources
              {hasBoards ? ', and board changes wait for you to apply them' : ''}. You can leave and
              come back — the conversation stays open.
            </p>
          </div>
        </form>
      </section>

      {peekSlug && <SopPeekModal slug={peekSlug} onClose={() => setPeekSlug(null)} />}
    </div>
  );
}
