import { describe, expect, it } from 'vitest';
import {
  describeToolCall,
  serializeToolOutput,
  summarizeToolResult,
  summarizeTrail,
  TRAIL_OUTPUT_MAX_LENGTH,
  type TrailStep,
  trailFromJson,
  trailWithCalls,
  trailWithResult,
  trailWithThought,
} from './trail';

const search: TrailStep = {
  kind: 'tool',
  callId: 'a',
  tool: 'search_knowledge_base',
  input: { query: 'shock' },
  status: 'running',
};

describe('trail building', () => {
  it('appends tool calls once and records their results', () => {
    let trail = trailWithCalls(
      [],
      [{ callId: 'a', tool: 'search_knowledge_base', input: { query: 'shock' } }]
    );
    expect(trail).toEqual([search]);
    trail = trailWithCalls(trail, [{ callId: 'a', tool: 'search_knowledge_base', input: {} }]);
    expect(trail).toHaveLength(1);
    trail = trailWithResult(trail, { callId: 'a', status: 'completed', output: '{"count":3}' });
    expect(trail[0]).toMatchObject({ status: 'completed', output: '{"count":3}' });
    expect(trailWithResult(trail, { callId: 'nope', status: 'failed' })).toEqual(trail);
  });

  it('keeps narration but not blank lines', () => {
    expect(trailWithThought([], '  ')).toEqual([]);
    expect(trailWithThought([], ' Let me look. ')).toEqual([
      { kind: 'thought', text: 'Let me look.' },
    ]);
  });

  it('reads a stored trail and drops malformed steps', () => {
    expect(
      trailFromJson([
        { kind: 'thought', text: 'hmm' },
        { kind: 'tool', callId: 'a', tool: 'read_sop', input: {}, status: 'completed' },
        { kind: 'tool', tool: 'read_sop' },
        'junk',
      ])
    ).toHaveLength(2);
    expect(trailFromJson(null)).toEqual([]);
  });
});

describe('describing steps', () => {
  it('names the tool and its key argument', () => {
    expect(describeToolCall({ tool: 'search_knowledge_base', input: { query: 'shock' } })).toBe(
      'Searched "shock"'
    );
    expect(
      describeToolCall({ tool: 'read_sop', input: { slug: 'closing', section: 'fire' } })
    ).toBe('Read closing#fire');
    expect(describeToolCall({ tool: 'list_sops', input: {} })).toBe('Browsed the library');
  });

  it('summarises results per tool', () => {
    const done = (tool: string, output: unknown): TrailStep => ({
      kind: 'tool',
      callId: 'x',
      tool,
      input: {},
      status: 'completed',
      output: serializeToolOutput(output),
    });
    expect(summarizeToolResult(done('search_knowledge_base', { count: 4 }) as never)).toBe(
      '4 hits'
    );
    expect(summarizeToolResult(done('search_knowledge_base', { count: 1 }) as never)).toBe('1 hit');
    expect(
      summarizeToolResult(
        done('read_sop', { title: 'Closing', section: { heading: 'Fire side' } }) as never
      )
    ).toBe('Closing › Fire side');
    expect(summarizeToolResult(done('read_sop', { found: false, error: 'No SOP' }) as never)).toBe(
      'No SOP'
    );
    expect(summarizeToolResult(done('get_shift_notes', { notes: [1, 2] }) as never)).toBe(
      '2 entries'
    );
    expect(summarizeToolResult({ ...search, status: 'failed', error: 'boom' })).toBe(
      'failed: boom'
    );
    expect(summarizeToolResult(search)).toBe('running');
  });

  it('caps long outputs', () => {
    const out = serializeToolOutput('x'.repeat(TRAIL_OUTPUT_MAX_LENGTH + 10));
    expect(out.startsWith('x'.repeat(TRAIL_OUTPUT_MAX_LENGTH))).toBe(true);
    expect(out).toContain('10 more characters');
  });

  it('summarises a trail by what it did', () => {
    expect(summarizeTrail([])).toBe('Answered without looking anything up');
    expect(
      summarizeTrail([
        { kind: 'thought', text: 'x' },
        search,
        { ...search, callId: 'b' },
        { kind: 'tool', callId: 'c', tool: 'read_sop', input: {}, status: 'completed' },
      ])
    ).toBe('Searched · Read — 3 lookups');
  });
});
