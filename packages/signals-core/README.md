# @pyre/signals-core

The shared vocabulary for classifying staff-written text with Jev (TypeSafe
AI's System One evaluation model), called directly through
[`@pyre/jev`](../jev). Shift notes are the first thing classified.

- **Signals** (`src/signals.ts`) are what gets detected: `action`,
  `question`, `update`, `feedback`, `safety`. Jev answers one yes/no
  question per signal with a probability; each signal has a threshold
  (default 0.5, safety 0.35) for counting as found.
- **Subjects** (`src/subjects.ts`) are the kinds of record it can read:
  `shift_note`.
- **Classification** (`src/classify.ts`): `classifySignals(subject, text)`
  asks Jev the questions and returns the signals that clear their
  thresholds, applying **validation** (`src/validate.ts`) and **text
  normalisation** (`src/message.ts`).

## How it flows

Nothing below runs while a person waits: the note is saved and its response
sent first.

```
shift note POST / PATCH (apps/integrations) ─▶ response sent
  └─ waitUntil: publish a QStash job           lib/classify/dispatch.ts
       └─ QStash ─▶ POST /api/classify/run      (retried with backoff on failure)
            runClassification()                 lib/classify/request.ts
              files a pending content_classifications row (fresh request_id)
              └─ classifySignals()                (this package, via @pyre/jev)
                   └─ AI Gateway → Jev (typesafe-ai/jev): one boolean question per signal
                   keeps what clears each threshold → row done
/admin/shift-notes (admins): chips per note, "detected" filter, polling while pending
```

## Detect something new

Add an entry to `SIGNAL_DEFINITIONS` in `src/signals.ts`: key, label,
definition, a couple of examples, and optionally a threshold. That is all it
takes to detect, store, filter, and show it: the question put to Jev, the
thresholds, and the UI labels all read this list, and only the integrations
app redeploys. Optionally give it a colour
in `SIGNAL_TONES` (`apps/integrations/src/components/admin/Signals.tsx`).
Never reuse a retired key for a different meaning; stored rows keep it.

## Classify another kind of record

1. Add an entry to `SUBJECT_DEFINITIONS` in `src/subjects.ts` (what it is,
   which signals apply).
2. New migration: extend the `subject_type` check on
   `content_classifications` and attach the cleanup trigger to the record's
   table (`execute function public.delete_content_classification('<key>')`).
3. In apps/integrations, add its entry to `SUBJECT_SOURCES`
   (`src/lib/classify/subjects.ts` — the compiler insists; the worker
   reads the text through it), call `scheduleClassification('<key>', id, text)` from the route
   that writes it, and return `loadClassifications(db, '<key>', ids)` from
   the route that lists it.
4. In the page's island: `useClassifications('<key>', canSee)` and
   `<SignalChips>` / `<SignalFilter>` from `components/admin/Signals.tsx`.

Nothing else changes: the questions are built from the registry.
