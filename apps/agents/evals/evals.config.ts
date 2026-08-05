import { defineEvalConfig } from 'eve/evals';

// LLM-judge checks (rationale quality) also route through AI Gateway.
export default defineEvalConfig({
  judge: { model: 'anthropic/claude-sonnet-5' },
});
