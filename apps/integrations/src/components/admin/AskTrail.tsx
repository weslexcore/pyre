// The assistant's trail for one answer on /admin/ask: the narration it
// wrote between lookups and every tool it called, with the call's input
// and result behind a click. It fills in live while the answer is being
// worked out and stays beside the answer afterwards, so "how did it get
// that?" has somewhere to go. Reopened conversations get the trail the
// agent stored with the turn (knowledge_queries.trail).

import { useState } from 'react';
import {
  describeToolCall,
  summarizeToolResult,
  summarizeTrail,
  TOOL_ACTIVITY_LABELS,
  type TrailStep,
} from '@/lib/knowledge/trail';

interface Props {
  steps: TrailStep[];
  /** True while the answer is still being worked out. */
  live: boolean;
  open: boolean;
  onToggle: () => void;
}

/** Narration rows show this much before a click reveals the rest. */
const THOUGHT_PREVIEW_LENGTH = 140;

const STATUS_CLASS: Record<Extract<TrailStep, { kind: 'tool' }>['status'], string> = {
  running: 'text-white/50',
  completed: 'text-[var(--pyre-sage)]',
  failed: 'text-[var(--pyre-red)]',
};

/** A tool's output, pretty when it is JSON, plain otherwise. */
function formatOutput(output: string): string {
  try {
    return JSON.stringify(JSON.parse(output), null, 2);
  } catch {
    return output;
  }
}

function stepKey(step: TrailStep, index: number): string {
  return step.kind === 'tool' ? `tool-${step.callId || index}` : `thought-${index}`;
}

/** The line shown while the assistant is mid-lookup, from the newest running step. */
export function liveActivityLabel(steps: TrailStep[]): string {
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step.kind === 'tool' && step.status === 'running') {
      return TOOL_ACTIVITY_LABELS[step.tool] ?? 'Working';
    }
  }
  return 'Thinking';
}

export function AskTrail({ steps, live, open, onToggle }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleStep = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (steps.length === 0 && !live) return null;

  const headline = live ? `${liveActivityLabel(steps)}…` : summarizeTrail(steps);

  return (
    <div className="mb-3 rounded border border-white/10 bg-black/20 text-xs">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left font-mono uppercase tracking-wide text-white/50 hover:text-white/80"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className={live ? 'animate-pulse' : ''}>{headline}</span>
        <span className="shrink-0 text-[10px] text-white/40">
          {open ? 'Hide steps' : `Show ${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`}
        </span>
      </button>

      {open && steps.length > 0 && (
        <ol className="border-t border-white/10">
          {steps.map((step, index) => {
            const key = stepKey(step, index);
            const isOpen = expanded.has(key);
            if (step.kind === 'thought') {
              const long = step.text.length > THOUGHT_PREVIEW_LENGTH;
              return (
                <li key={key} className="border-b border-white/5 last:border-b-0">
                  <button
                    type="button"
                    className="flex w-full items-start gap-2 px-3 py-1.5 text-left text-white/60 hover:text-white/90"
                    onClick={() => long && toggleStep(key)}
                    aria-expanded={long ? isOpen : undefined}
                  >
                    <span className="mt-0.5 shrink-0 font-mono text-[10px] uppercase tracking-wide text-white/30">
                      Thought
                    </span>
                    <span className="whitespace-pre-wrap italic">
                      {isOpen || !long
                        ? step.text
                        : `${step.text.slice(0, THOUGHT_PREVIEW_LENGTH).trimEnd()}…`}
                    </span>
                  </button>
                </li>
              );
            }
            return (
              <li key={key} className="border-b border-white/5 last:border-b-0">
                <button
                  type="button"
                  className="flex w-full items-start gap-2 px-3 py-1.5 text-left text-white/70 hover:text-white"
                  onClick={() => toggleStep(key)}
                  aria-expanded={isOpen}
                >
                  <span className="mt-0.5 shrink-0 font-mono text-[10px] uppercase tracking-wide text-white/30">
                    Lookup
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{describeToolCall(step)}</span>
                    <span
                      className={`block truncate font-mono text-[10px] uppercase tracking-wide ${STATUS_CLASS[step.status]} ${step.status === 'running' ? 'animate-pulse' : ''}`}
                    >
                      {summarizeToolResult(step)}
                    </span>
                  </span>
                </button>
                {isOpen && (
                  <div className="space-y-2 px-3 pb-3">
                    <div>
                      <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-[var(--pyre-gold)]">
                        Input
                      </p>
                      <pre className="max-h-40 overflow-auto rounded border border-white/10 bg-black/40 p-2 font-mono text-[11px] leading-snug text-white/70">
                        {JSON.stringify(step.input, null, 2)}
                      </pre>
                    </div>
                    <div>
                      <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-[var(--pyre-gold)]">
                        Result
                      </p>
                      {step.error && <p className="mb-1 text-[var(--pyre-red)]">{step.error}</p>}
                      {step.output ? (
                        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded border border-white/10 bg-black/40 p-2 font-mono text-[11px] leading-snug text-white/70">
                          {formatOutput(step.output)}
                        </pre>
                      ) : (
                        <p className="text-white/40">
                          {step.status === 'running' ? 'Still running.' : 'No output was recorded.'}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
