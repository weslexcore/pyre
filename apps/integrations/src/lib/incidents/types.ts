// Incident taxonomy: the fixed vocabularies the report form offers and the
// API validates against. Keep this module client-bundle-safe (no db/env
// imports) — the React islands import it directly, and the check constraints
// in the incidents migration mirror these lists.
//
// The site is outdoors, so the areas are grounds, not rooms, and weather is a
// first-class contributing factor.

export const INCIDENT_CATEGORIES = [
  'slip_fall',
  'burn_heat',
  'cut_laceration',
  'heat_illness',
  'cold_exposure',
  'fainting',
  'breathing_difficulty',
  'allergic_reaction',
  'chemical_exposure',
  'medical_event',
  'equipment_failure',
  'facility_damage',
  'fire_smoke',
  'altercation',
  'harassment',
  'intoxication',
  'policy_violation',
  'theft_security',
  'hygiene_contamination',
  'other',
] as const;

export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number];

export interface CategoryOption {
  value: IncidentCategory;
  label: string;
  /** One-line disambiguation shown under the label on the picker. */
  hint: string;
}

// Order matters: the form renders these as big tap targets, most-common
// first, so the usual incidents are reachable without scrolling.
export const CATEGORY_OPTIONS: CategoryOption[] = [
  { value: 'slip_fall', label: 'Slip / trip / fall', hint: 'Wet decking, steps, paths, ice' },
  { value: 'burn_heat', label: 'Burn', hint: 'Sauna rocks, stove, heater, hot surface, steam' },
  { value: 'heat_illness', label: 'Heat illness', hint: 'Overheating, dizziness, nausea, cramps' },
  { value: 'fainting', label: 'Fainting / lightheaded', hint: 'Passed out or nearly did' },
  { value: 'cut_laceration', label: 'Cut / bruise / sprain', hint: 'Broken glass, edges, impact' },
  { value: 'cold_exposure', label: 'Cold plunge reaction', hint: 'Cold shock, numbness, panic' },
  {
    value: 'breathing_difficulty',
    label: 'Breathing difficulty',
    hint: 'Steam, smoke, asthma, chest tightness',
  },
  { value: 'allergic_reaction', label: 'Allergic reaction', hint: 'Products, oils, food, insects' },
  {
    value: 'medical_event',
    label: 'Other medical event',
    hint: 'Seizure, cardiac, diabetic, other',
  },
  {
    value: 'chemical_exposure',
    label: 'Chemical exposure',
    hint: 'Chlorine, shock, cleaning products',
  },
  {
    value: 'equipment_failure',
    label: 'Equipment failure',
    hint: 'Stove, pump, heater, door, lock',
  },
  { value: 'facility_damage', label: 'Property damage', hint: 'Damage, leak, breakage on site' },
  { value: 'fire_smoke', label: 'Fire / smoke', hint: 'Any fire, smoke, or alarm activation' },
  { value: 'altercation', label: 'Altercation', hint: 'Conflict between people on site' },
  { value: 'harassment', label: 'Harassment', hint: 'Toward a guest or a staff member' },
  { value: 'intoxication', label: 'Intoxication', hint: 'Impaired guest, alcohol or substances' },
  { value: 'policy_violation', label: 'Policy violation', hint: 'Rules broken, guest removed' },
  {
    value: 'theft_security',
    label: 'Theft / security',
    hint: 'Missing property, trespass, break-in',
  },
  {
    value: 'hygiene_contamination',
    label: 'Hygiene / contamination',
    hint: 'Bodily fluids, contamination event',
  },
  { value: 'other', label: 'Something else', hint: 'Describe it below' },
];

export const CATEGORY_LABELS: Record<IncidentCategory, string> = Object.fromEntries(
  CATEGORY_OPTIONS.map((o) => [o.value, o.label])
) as Record<IncidentCategory, string>;

export const INCIDENT_SEVERITIES = [
  'near_miss',
  'minor',
  'moderate',
  'severe',
  'critical',
] as const;

export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export interface SeverityOption {
  value: IncidentSeverity;
  label: string;
  hint: string;
}

// Plain-language anchors so two different people classify the same event the
// same way. "Would this have gone to a doctor?" is the dividing line.
export const SEVERITY_OPTIONS: SeverityOption[] = [
  { value: 'near_miss', label: 'Near miss', hint: 'Nobody was hurt' },
  { value: 'minor', label: 'Minor', hint: 'First aid on site, carried on' },
  { value: 'moderate', label: 'Moderate', hint: 'Stopped their session, may see a doctor' },
  { value: 'severe', label: 'Severe', hint: 'Needed medical care or left in an ambulance' },
  { value: 'critical', label: 'Critical', hint: 'Life-threatening, or the site was evacuated' },
];

export const SEVERITY_LABELS: Record<IncidentSeverity, string> = Object.fromEntries(
  SEVERITY_OPTIONS.map((o) => [o.value, o.label])
) as Record<IncidentSeverity, string>;

/** Severities that page management the moment the report is filed. */
export const URGENT_SEVERITIES: IncidentSeverity[] = ['severe', 'critical'];

export const INCIDENT_STATUSES = [
  'submitted',
  'under_review',
  'action_required',
  'resolved',
  'closed',
  'voided',
] as const;

export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const STATUS_LABELS: Record<IncidentStatus, string> = {
  submitted: 'Submitted',
  under_review: 'Under review',
  action_required: 'Action required',
  resolved: 'Resolved',
  closed: 'Closed',
  voided: 'Voided',
};

/** Statuses that still need someone to do something. */
export const OPEN_STATUSES: IncidentStatus[] = ['submitted', 'under_review', 'action_required'];

// Areas of the site. Free text stays available in area_detail; this list
// exists so the log can be grouped by where things keep happening.
export const INCIDENT_AREAS = [
  'sauna',
  'cold_plunge',
  'showers',
  'changing_area',
  'restroom',
  'check_in',
  'lounge',
  'deck',
  'path_stairs',
  'parking_lot',
  'equipment_area',
  'staff_area',
  'other',
] as const;

export type IncidentArea = (typeof INCIDENT_AREAS)[number];

export const AREA_LABELS: Record<IncidentArea, string> = {
  sauna: 'Sauna',
  cold_plunge: 'Cold plunge',
  showers: 'Showers',
  changing_area: 'Changing area',
  restroom: 'Restroom',
  check_in: 'Check-in',
  lounge: 'Lounge / fire',
  deck: 'Deck',
  path_stairs: 'Paths / stairs',
  parking_lot: 'Parking',
  equipment_area: 'Equipment area',
  staff_area: 'Staff area',
  other: 'Somewhere else',
};

// Conditions that contributed. Checkboxes rather than prose because these are
// what a trends review actually queries — "how many falls happened on ice?"
// is the question that changes how the site is run.
export const CONTRIBUTING_FACTORS = [
  'wet_surface',
  'standing_water',
  'ice_snow',
  'weather',
  'uneven_surface',
  'poor_lighting',
  'missing_signage',
  'obstruction',
  'equipment_malfunction',
  'excessive_heat',
  'overcrowding',
  'no_staff_present',
  'guest_behavior',
  'intoxication',
  'pre_existing_condition',
  'first_visit',
  'ignored_instructions',
  'unknown',
] as const;

export type ContributingFactor = (typeof CONTRIBUTING_FACTORS)[number];

export const FACTOR_LABELS: Record<ContributingFactor, string> = {
  wet_surface: 'Wet surface',
  standing_water: 'Standing water',
  ice_snow: 'Ice or snow',
  weather: 'Weather — rain, wind, heat',
  uneven_surface: 'Uneven / slippery ground',
  poor_lighting: 'Poor lighting',
  missing_signage: 'Missing or unclear signage',
  obstruction: 'Obstruction in the way',
  equipment_malfunction: 'Equipment malfunction',
  excessive_heat: 'Excessive heat',
  overcrowding: 'Overcrowding',
  no_staff_present: 'No staff nearby',
  guest_behavior: 'Guest behavior',
  intoxication: 'Intoxication',
  pre_existing_condition: 'Pre-existing condition',
  first_visit: "Guest's first visit",
  ignored_instructions: 'Instructions not followed',
  unknown: 'Unknown',
};

// Who someone is, which also decides where the form looks them up: a guest
// is searched in Momence, a staff member is picked off our roster, and
// 'other' is typed in by hand (a passer-by, a delivery driver, a contractor).
export const PERSON_ROLES = ['guest', 'staff', 'other'] as const;

export type PersonRole = (typeof PERSON_ROLES)[number];

export const PERSON_ROLE_LABELS: Record<PersonRole, string> = {
  guest: 'Guest',
  staff: 'Staff',
  other: 'Other',
};

// Body parts, coarse enough that anyone picks the same one. Injury nature is
// free text — a list there would only ever be wrong.
export const BODY_PARTS = [
  'head',
  'face',
  'eye',
  'neck',
  'shoulder',
  'arm',
  'hand',
  'chest',
  'back',
  'abdomen',
  'hip',
  'leg',
  'knee',
  'ankle',
  'foot',
  'multiple',
  'other',
] as const;

export type BodyPart = (typeof BODY_PARTS)[number];

/**
 * Identity fields shared by everyone a report names, whether the incident
 * happened to them or they only saw it. Filled by the Momence search (guest),
 * the roster picker (staff), or by hand ('other').
 */
export interface PersonIdentity {
  role: PersonRole;
  name: string;
  phone: string;
  email: string;
  /** Momence member id when the guest was matched in the search. */
  memberId: string;
}

/** One person the incident happened to. */
export interface AffectedPerson extends PersonIdentity {
  injured: boolean;
  /** Free text: "second-degree burn", "sprained ankle". */
  injuryNature: string;
  bodyParts: BodyPart[];
  notes: string;
}

/** Someone who saw it. Statements are captured verbatim while memory is fresh. */
export interface Witness extends PersonIdentity {
  statement: string;
}

export function emptyPersonIdentity(): PersonIdentity {
  return { role: 'guest', name: '', phone: '', email: '', memberId: '' };
}

export function emptyAffectedPerson(): AffectedPerson {
  return {
    ...emptyPersonIdentity(),
    injured: true,
    injuryNature: '',
    bodyParts: [],
    notes: '',
  };
}

export function emptyWitness(): Witness {
  return { ...emptyPersonIdentity(), statement: '' };
}

export function isIncidentCategory(v: unknown): v is IncidentCategory {
  return typeof v === 'string' && (INCIDENT_CATEGORIES as readonly string[]).includes(v);
}

export function isIncidentSeverity(v: unknown): v is IncidentSeverity {
  return typeof v === 'string' && (INCIDENT_SEVERITIES as readonly string[]).includes(v);
}

export function isIncidentStatus(v: unknown): v is IncidentStatus {
  return typeof v === 'string' && (INCIDENT_STATUSES as readonly string[]).includes(v);
}

export function isIncidentArea(v: unknown): v is IncidentArea {
  return typeof v === 'string' && (INCIDENT_AREAS as readonly string[]).includes(v);
}

/** Label for an area code, tolerating rows written before a list change. */
export function areaLabel(value: string): string {
  return isIncidentArea(value) ? AREA_LABELS[value] : value;
}

export function categoryLabel(value: string): string {
  return isIncidentCategory(value) ? CATEGORY_LABELS[value] : value;
}

export function severityLabel(value: string): string {
  return isIncidentSeverity(value) ? SEVERITY_LABELS[value] : value;
}

export function statusLabel(value: string): string {
  return isIncidentStatus(value) ? STATUS_LABELS[value] : value;
}

export function factorLabel(value: string): string {
  return (FACTOR_LABELS as Record<string, string>)[value] ?? value;
}

/** Label for a stored role, tolerating rows written before a list change. */
export function personRoleLabel(value: string): string {
  return (PERSON_ROLE_LABELS as Record<string, string>)[value] ?? value;
}
