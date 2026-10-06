import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { type AssistRequest, buildAssistPrompt, runSopAssist } from './assist';

function modelReturning(output: Record<string, unknown>) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text: JSON.stringify(output) }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 20, text: 20, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

const PROPOSAL = {
  title: 'Cold tub shock',
  contentMd: '## Steps\n- [ ] Add TBD oz of oxidizer',
  summary: 'Drafted the steps.',
  changeNote: 'Drafted from notes',
  openQuestions: ['How much oxidizer per tub?', ' '],
  findings: [{ kind: 'clarity', severity: 'low', excerpt: '', issue: 'x', fix: 'y' }],
};

const REQUEST: AssistRequest = {
  mode: 'draft',
  sop: { slug: 'cold-tub-shock', category: 'Water' },
  title: 'Cold tub shock',
  content: '# Cold tub shock\n',
  notes: 'shock w oxidizer after close, pump on 30 min',
  context: {
    library: [{ slug: 'water-log', title: 'Water log', category: 'Water' }],
    examples: [{ title: 'Water log', contentMd: '## Daily\n- [ ] Test chlorine' }],
  },
};

describe('buildAssistPrompt', () => {
  it('carries the notes, the library links, and the examples for a draft', () => {
    const prompt = buildAssistPrompt(REQUEST);
    expect(prompt).toContain('Your task: draft');
    expect(prompt).toContain('<rough-notes>\nshock w oxidizer');
    expect(prompt).toContain('/admin/sops/water-log');
    expect(prompt).toContain('<example-document title="Water log">');
  });

  it('leaves the notes out of a review', () => {
    const prompt = buildAssistPrompt({ ...REQUEST, mode: 'review', notes: 'ignored' });
    expect(prompt).toContain('Your task: review');
    expect(prompt).not.toContain('<rough-notes>');
  });
});

describe('runSopAssist', () => {
  it('returns a cleaned-up proposal, without findings for a draft', async () => {
    const proposal = await runSopAssist(REQUEST, { model: modelReturning(PROPOSAL) });
    expect(proposal.contentMd).toBe('## Steps\n- [ ] Add TBD oz of oxidizer\n');
    expect(proposal.openQuestions).toEqual(['How much oxidizer per tub?']);
    expect(proposal.findings).toEqual([]);
  });

  it('keeps findings for a review and strips a repeated title heading', async () => {
    const proposal = await runSopAssist(
      { ...REQUEST, mode: 'review' },
      {
        model: modelReturning({
          ...PROPOSAL,
          title: '# Cold tub shock',
          contentMd: '# Cold Tub Shock\n\n## Steps\n- [ ] Run the pump',
        }),
      }
    );
    expect(proposal.title).toBe('Cold tub shock');
    expect(proposal.contentMd).toBe('## Steps\n- [ ] Run the pump\n');
    expect(proposal.findings).toHaveLength(1);
  });
});
