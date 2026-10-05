import type { IndexCardData } from '../../templates/index-card/types.ts';

type Note = 'Top' | 'Heart' | 'Base';
type Group = 'Uplifting' | 'Soothing' | 'Balanced';

/** Where each oil sits in a blend: top notes fade first, heart notes carry the body, base notes linger. */
const NOTES = {
  Bergamot: 'Top',
  Cedarwood: 'Base',
  'Clary Sage': 'Heart',
  Eucalyptus: 'Top',
  Frankincense: 'Base',
  Geranium: 'Heart',
  Lavender: 'Heart',
  Lemon: 'Top',
  Patchouli: 'Base',
  Peppermint: 'Top',
  'Roman Chamomile': 'Heart',
  Rose: 'Heart',
  Rosemary: 'Heart',
  Sandalwood: 'Base',
  'Sweet Orange': 'Top',
  'Tulsi Basil': 'Heart',
} satisfies Record<string, Note>;

interface Blend {
  group: Group;
  name: string;
  effect: string;
  oils: [oil: keyof typeof NOTES, drops: number][];
}

const blends: Blend[] = [
  {
    group: 'Uplifting',
    name: 'Christmas',
    effect: 'Cozy and energizing',
    oils: [
      ['Peppermint', 2],
      ['Patchouli', 3],
      ['Sweet Orange', 3],
    ],
  },
  {
    group: 'Uplifting',
    name: 'Anti Scurvy Blend',
    effect: 'Energizing and mood boosting',
    oils: [
      ['Lemon', 3],
      ['Bergamot', 3],
      ['Sweet Orange', 3],
    ],
  },
  {
    group: 'Uplifting',
    name: 'Wake Up',
    effect: 'Invigorating, mental clarity',
    oils: [
      ['Lemon', 3],
      ['Rosemary', 3],
      ['Peppermint', 2],
    ],
  },
  {
    group: 'Soothing',
    name: 'Pyre Signature',
    effect: 'Calming and warm',
    oils: [
      ['Cedarwood', 3],
      ['Rose', 5],
    ],
  },
  {
    group: 'Soothing',
    name: 'Relax and Refresh',
    effect: 'Relaxes muscles, opens senses, grounds',
    oils: [
      ['Roman Chamomile', 3],
      ['Eucalyptus', 2],
      ['Sandalwood', 3],
    ],
  },
  {
    group: 'Soothing',
    name: 'Calm and Soothe',
    effect: 'Eases anxiety, relaxing',
    oils: [
      ['Lavender', 3],
      ['Rose', 3],
      ['Sweet Orange', 2],
    ],
  },
  {
    group: 'Balanced',
    name: 'Herb Garden',
    effect: 'Eases tension, provides focus',
    oils: [
      ['Rosemary', 2],
      ['Clary Sage', 2],
      ['Tulsi Basil', 2],
      ['Lavender', 2],
    ],
  },
  {
    group: 'Balanced',
    name: 'Heart Blend',
    effect: 'Eases stress, supports emotional openness',
    oils: [
      ['Frankincense', 3],
      ['Clary Sage', 3],
      ['Geranium', 3],
    ],
  },
  {
    group: 'Balanced',
    name: 'Fresh Earth',
    effect: 'To center, boost mood, and find balance',
    oils: [
      ['Bergamot', 3],
      ['Cedarwood', 3],
      ['Geranium', 2],
    ],
  },
];

const drops = (n: number) => `${n} ${n === 1 ? 'drop' : 'drops'}`;

/** Rows read like the blend evaporates: top notes first, base notes last. */
const NOTE_ORDER: Record<Note, number> = { Top: 0, Heart: 1, Base: 2 };
const byNote = ([a]: Blend['oils'][number], [b]: Blend['oils'][number]) =>
  NOTE_ORDER[NOTES[a]] - NOTE_ORDER[NOTES[b]];

export const cards: IndexCardData[] = blends.map((blend) => ({
  eyebrow: `${blend.group} blend`,
  title: blend.name,
  lede: blend.effect,
  rows: [...blend.oils]
    .sort(byNote)
    .map(([oil, n]) => ({ label: oil, value: drops(n), tag: NOTES[oil] })),
  footnote: `${drops(blend.oils.reduce((sum, [, n]) => sum + n, 0))} total`,
  accent: blend.group.toLowerCase(),
}));
