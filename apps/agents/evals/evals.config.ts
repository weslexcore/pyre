import { defineEvalConfig } from 'eve/evals';

// Rationale-quality checks are graded by Jev (TypeSafe AI's evaluation model)
// through AI Gateway: each t.judge criterion is a yes/no question it answers
// with a probability, and the evals set their bar with .atLeast().
export default defineEvalConfig({
  judge: { model: 'typesafe-ai/jev' },
});
