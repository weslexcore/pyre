# @pyre/signals-core

The shared vocabulary for classifying staff-written text with Jev (TypeSafe
AI's System One evaluation model), called through the pyre-agents Eve app.
Shift notes are the first thing classified.

- **Signals** (`src/signals.ts`) are what gets detected: `action`,
  `question`, `update`, `feedback`, `safety`. Jev answers one yes/no
  question per signal with a probability; each signal has a threshold
  (default 0.5, safety 0.35) for counting as found.
- **Subjects** (`src/subjects.ts`) are the kinds of record it can read:
  `shift_note`.
- **Validation** (`src/validate.ts`) and **text normalisation**
  (`src/message.ts`) are the rules both apps apply.

## How it flows

Nothing below runs while a person waits: the note is saved and its response
sent first.

```
shift note POST / PATCH (apps/integrations) ─▶ response sent
  └─ waitUntil: runClassification()          lib/classify/request.ts
       files a pending content_classifications row (fresh request_id)
       └─ POST {pyre-agents}/pyre/classify { subject, text }
            └─ Jev (typesafe-ai/jev): one boolean question per signal
       parseSignals() keeps what clears each threshold → row done
  hourly cron classify-sweep: re-runs anything that never landed
/admin/shift-notes (admins): chips per note, "detected" filter, polling while pending
```

## Detect something new

Add an entry to `SIGNAL_DEFINITIONS` in `src/signals.ts`: key, label,
definition, a couple of examples, and optionally a threshold. That is all it
takes to detect, store, filter, and show it: the question put to Jev, the
server validation, and the UI labels all read this list. Optionally give it a colour
in `SIGNAL_TONES` (`apps/integrations/src/components/admin/Signals.tsx`).
Never reuse a retired key for a different meaning; stored rows keep it.

## Classify another kind of record

1. Add an entry to `SUBJECT_DEFINITIONS` in `src/subjects.ts` (what it is,
   which signals apply).
2. New migration: extend the `subject_type` check on
   `content_classifications` and attach the cleanup trigger to the record's
   table (`execute function public.delete_content_classification('<key>')`).
3. In apps/integrations, add its entry to `SUBJECT_SOURCES`
   (`src/lib/classify/subjects.ts` — the compiler insists; the sweep uses
   it too), call `scheduleClassification('<key>', id, text)` from the route
   that writes it, and return `loadClassifications(db, '<key>', ids)` from
   the route that lists it.
4. In the page's island: `useClassifications('<key>', canSee)` and
   `<SignalChips>` / `<SignalFilter>` from `components/admin/Signals.tsx`.

No agent change is needed beyond shipping this package.
