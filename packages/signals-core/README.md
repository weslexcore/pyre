# @pyre/signals-core

The shared vocabulary for classifying staff-written text with the pyre-agents
classifier (Vercel Eve). Shift notes are the first thing classified.

- **Signals** (`src/signals.ts`) are what the classifier detects: `action`,
  `question`, `update`, `feedback`, `safety`.
- **Subjects** (`src/subjects.ts`) are the kinds of record it can read:
  `shift_note`.
- **Validation** (`src/validate.ts`) and the **request message**
  (`src/message.ts`) are the payload rules both apps enforce.

## How it flows

```
shift note POST / PATCH (apps/integrations)
  └─ requestClassification()            lib/classify/request.ts
       files a pending content_classifications row (fresh request_id)
       └─ POST {pyre-agents}/eve/v1/session
            x-pyre-agent: classifier, x-pyre-classify-request: <request_id>
            message: <classify subject="shift_note"><text>…</text></classify>
               └─ classifier role: prompt built from this package
                  └─ save_classification ─▶ POST /api/agent/classifications
                                             validated with parseSignals()
                                             row → done, signals stored
/admin/shift-notes (admins) ◀─ GET returns classifications; <SignalChips>,
                               "detected" filter, polling while pending
```

## Detect something new

Add an entry to `SIGNAL_DEFINITIONS` in `src/signals.ts`: key, label,
definition, and a couple of examples. That is all it takes to detect, store,
filter, and show it: the classifier's prompt and tool schema, the server
validation, and the UI labels all read this list. Optionally give it a colour
in `SIGNAL_TONES` (`apps/integrations/src/components/admin/Signals.tsx`).
Never reuse a retired key for a different meaning; stored rows keep it.

## Classify another kind of record

1. Add an entry to `SUBJECT_DEFINITIONS` in `src/subjects.ts` (what it is,
   which signals apply).
2. New migration: extend the `subject_type` check on
   `content_classifications` and attach the cleanup trigger to the record's
   table (`execute function public.delete_content_classification('<key>')`).
3. In apps/integrations, add its entry to `SUBJECT_SOURCES`
   (`src/lib/classify/subjects.ts` — the compiler insists), call
   `requestClassification(db, '<key>', id, text)` from the route that writes
   it, and return `loadClassifications(db, '<key>', ids)` from the route that
   lists it.
4. In the page's island: `useClassifications('<key>', canSee)` and
   `<SignalChips>` / `<SignalFilter>` from `components/admin/Signals.tsx`.

No agent change or redeploy of prompts is needed beyond shipping this package.
