import { describe, expect, it } from 'vitest';
import {
  diffIncidentFields,
  normalizeIncidentPatch,
  normalizeIncidentSubmission,
} from './validate';

const minimal = () => ({
  category: 'slip_fall',
  severity: 'minor',
  occurredAt: new Date(Date.now() - 10 * 60_000).toISOString(),
  area: 'cold_plunge',
  description: 'Guest slipped on standing water by the drain.',
  immediateActions: 'Helped them up, mopped the area, put out a wet floor sign.',
});

describe('normalizeIncidentSubmission', () => {
  it('accepts a minimal report and maps it to columns', () => {
    const result = normalizeIncidentSubmission(minimal());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.category).toBe('slip_fall');
    expect(result.value.area).toBe('cold_plunge');
    expect(result.value.immediate_actions).toContain('mopped');
  });

  it('rejects a missing required field', () => {
    const { description, ...rest } = minimal();
    void description;
    const result = normalizeIncidentSubmission(rest);
    expect(result.ok).toBe(false);
  });

  it('rejects an unknown category', () => {
    const result = normalizeIncidentSubmission({ ...minimal(), category: 'dragon_attack' });
    expect(result.ok).toBe(false);
  });

  it('rejects the categories that were retired', () => {
    for (const category of ['water_quality', 'near_miss']) {
      expect(normalizeIncidentSubmission({ ...minimal(), category }).ok).toBe(false);
    }
  });

  it('rejects an area that is not on the outdoor site', () => {
    const result = normalizeIncidentSubmission({ ...minimal(), area: 'lobby' });
    expect(result.ok).toBe(false);
  });

  it('rejects an occurrence time in the future', () => {
    const result = normalizeIncidentSubmission({
      ...minimal(),
      occurredAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/future/);
  });

  it('rejects a whitespace-only narrative', () => {
    const result = normalizeIncidentSubmission({ ...minimal(), description: '    ' });
    expect(result.ok).toBe(false);
  });

  it('drops blank people rows but keeps an unnamed injury', () => {
    const result = normalizeIncidentSubmission({
      ...minimal(),
      affectedPeople: [
        { role: 'guest', name: '', phone: '', email: '', memberId: '', injured: false },
        { role: 'guest', name: '', injured: true, injuryNature: 'Scraped knee' },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.affected_people).toHaveLength(1);
  });

  it('falls back to guest for a role that is no longer offered', () => {
    const result = normalizeIncidentSubmission({
      ...minimal(),
      affectedPeople: [{ role: 'contractor', name: 'Pat Lane', injured: false }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [person] = result.value.affected_people as { role: string }[];
    expect(person.role).toBe('guest');
  });

  it('keeps a Momence member id and rejects a non-numeric one', () => {
    const result = normalizeIncidentSubmission({
      ...minimal(),
      affectedPeople: [
        { role: 'guest', name: 'Sam Reed', memberId: '84321', injured: true },
        { role: 'guest', name: 'Alex Wu', memberId: 'not-an-id', injured: false },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const people = result.value.affected_people as { memberId: string }[];
    expect(people[0].memberId).toBe('84321');
    expect(people[1].memberId).toBe('');
  });

  it('records a witness with the same identity fields as an affected person', () => {
    const result = normalizeIncidentSubmission({
      ...minimal(),
      witnesses: [
        {
          role: 'staff',
          name: 'Sunny',
          email: 'SUNNY@example.com',
          statement: 'Saw them go down by the drain.',
        },
        { role: 'other', name: '', statement: '' },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const witnesses = result.value.witnesses as { role: string; email: string }[];
    expect(witnesses).toHaveLength(1);
    expect(witnesses[0].role).toBe('staff');
    expect(witnesses[0].email).toBe('sunny@example.com');
  });

  it('normalizes emails and ignores unknown body parts', () => {
    const result = normalizeIncidentSubmission({
      ...minimal(),
      affectedPeople: [
        {
          role: 'guest',
          name: 'Sam Reed',
          email: 'SAM@Example.COM',
          injured: true,
          bodyParts: ['knee', 'tail'],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [person] = result.value.affected_people as {
      email: string;
      bodyParts: string[];
    }[];
    expect(person.email).toBe('sam@example.com');
    expect(person.bodyParts).toEqual(['knee']);
  });

  it('clears the EMS timestamp when EMS was not called', () => {
    const result = normalizeIncidentSubmission({
      ...minimal(),
      emsCalled: false,
      emsCalledAt: new Date().toISOString(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ems_called_at).toBeNull();
  });

  it('rejects an out-of-range temperature', () => {
    const result = normalizeIncidentSubmission({ ...minimal(), saunaTempF: 900 });
    expect(result.ok).toBe(false);
  });
});

describe('normalizeIncidentPatch', () => {
  it('touches only the keys that were sent', () => {
    const result = normalizeIncidentPatch({ severity: 'severe' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value)).toEqual(['severity']);
  });

  it('refuses to empty a required field', () => {
    const result = normalizeIncidentPatch({ description: '   ' });
    expect(result.ok).toBe(false);
  });

  it('rejects a key outside the allowed set', () => {
    const result = normalizeIncidentPatch({ resolutionNotes: 'Closed it out' }, ['description']);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/cannot be changed/);
  });
});

describe('diffIncidentFields', () => {
  it('records only genuine changes', () => {
    const before = {
      severity: 'minor',
      description: 'Same text',
      contributing_factors: ['wet_surface'],
    };
    const changes = diffIncidentFields(before, {
      severity: 'severe',
      description: 'Same text',
      contributing_factors: ['wet_surface'],
    });
    expect(Object.keys(changes)).toEqual(['severity']);
    expect(changes.severity).toEqual({ from: 'minor', to: 'severe' });
  });

  it('treats undefined and null on the previous row as the same absence', () => {
    const changes = diffIncidentFields({ area_detail: null }, { area_detail: null });
    expect(changes).toEqual({});
  });
});
