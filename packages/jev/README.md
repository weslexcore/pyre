# @pyre/jev

Jev (TypeSafe AI's System One evaluation model) for any Pyre app or agent.
Jev answers typed questions (boolean, choice, score) about a state you give
it, instead of writing prose, so it suits classification and triage.

It is an AI Gateway model, so each app calls it directly through the AI SDK
(`experimental_evaluate`). There is no service hop and no shared secret.
Credentials: Vercel OIDC when deployed, `AI_GATEWAY_API_KEY` locally.

```ts
import { askJev, askJevBooleans, jevAvailable } from '@pyre/jev';

// Yes/no questions → P(true) per key
const p = await askJevBooleans(
  { kind: 'guest email', text },
  {
    refund: { type: 'boolean', instructions: 'Is the guest asking for a refund?' },
    urgent: { type: 'boolean', instructions: 'Does this need an answer today?' },
  },
  { apiKey } // only where process.env does not carry AI_GATEWAY_API_KEY (Astro)
);

// Any question type → typed answers
const { answers } = await askJev(state, {
  topic: { type: 'choice', instructions: 'What is this about?', criteria: { booking: '…', billing: '…' } },
});
```

- `jevAvailable(apiKey?)` tells you whether Jev can be reached (a key, or
  running on Vercel), so a feature can switch off cleanly.
- Calls time out after 20s unless you pass an `abortSignal`.
- Tests pass `model: new Experimental_EvaluationMockModelV4(…)` from
  `ai/test`.
- In apps/integrations, `src/lib/jev.ts` resolves the key from Astro's env;
  call `askJev(state, questions, jevOptions())` from there.

Users: shift note signals (`@pyre/signals-core` → `classifySignals`).
