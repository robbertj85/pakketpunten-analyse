// Types + capacity model for the Netwerkplanner (locker_network/{slug}.json,
// produced by scripts/plan_locker_network.py).

export interface TypeMeta {
  label: string;
  prioriteit: number;
  buiten_24_7: boolean;
  sociale_controle: number;
  kleur: string;
}

export interface CapacityDefaults {
  pakketten_pp_jaar: number;
  verblijf_dagen: number;
  vakken_per_kolom: number;
  bezetting_max: number;
  kolommen_per_kast_max: number;
}

export interface NetworkCandidate {
  lat: number;
  lon: number;
  type: string;
  naam: string;
  flags: string[];
}

export interface NetworkPick {
  /** Index into candidates[]. */
  c: number;
  /** Inhabitants newly covered by this pick. */
  gain: number;
  /** Cumulative covered inhabitants after this pick. */
  cum: number;
}

export interface NetworkScenario {
  /** Inhabitants covered before any pick (existing network). */
  start_covered: number;
  picks: NetworkPick[];
  /** Per cell: 0 = covered at start, k = first covered by pick k, -1 = never. */
  cell_rank: number[];
}

export interface LockerNetworkPayload {
  generated_at: string;
  slug: string;
  gemeente: string;
  methodology: Record<string, string>;
  params: {
    distances: number[];
    starts: string[];
    min_gain: number;
    min_spacing_m: number;
    dedupe_m: number;
    max_picks: number;
  };
  type_meta: Record<string, TypeMeta>;
  capacity_defaults: CapacityDefaults;
  population_total: number;
  cells: { lat: number[]; lon: number[]; pop: number[] };
  candidates: NetworkCandidate[];
  existing: { alle_punten: number; automaten: number };
  scenarios: Record<string, NetworkScenario>;
}

export const START_LABELS: Record<string, string> = {
  greenfield: 'Lege kaart (greenfield)',
  automaten: 'Bestaande automaten',
  'alle-punten': 'Alle bestaande pakketpunten',
};

export const FLAG_LABELS: Record<string, string> = {
  ov: 'OV-nabij',
  sociale_controle: 'Sociale controle',
  '24_7': '24/7 buitenruimte',
  aandachtspunt_sociale_veiligheid: 'Aandachtspunt sociale veiligheid',
};

/** Parcels per day flowing through a locker serving `gain` inhabitants at a
 * given out-of-home share (0..1). */
export function parcelsPerDay(gain: number, cap: CapacityDefaults, oohShare: number): number {
  return (gain * cap.pakketten_pp_jaar * oohShare) / 365;
}

/** Locker columns needed for a pick, from its assigned population. */
export function columnsNeeded(gain: number, cap: CapacityDefaults, oohShare: number): number {
  const occupied = (parcelsPerDay(gain, cap, oohShare) * cap.verblijf_dagen) / cap.bezetting_max;
  return Math.max(1, Math.ceil(occupied / cap.vakken_per_kolom));
}

/** Cabinets needed for a given column count (max 17 columns per cabinet). */
export function cabinetsNeeded(columns: number, cap: CapacityDefaults): number {
  return Math.max(1, Math.ceil(columns / cap.kolommen_per_kast_max));
}

/** Running metres of cabinet frontage. Follows the 3D-viewer sizing table
 * (lib/lockerCatalog.ts): width = 49 cm per kolom + 8 cm frame per kast. */
export function metersNeeded(columns: number, cap: CapacityDefaults): number {
  const cabinets = cabinetsNeeded(columns, cap);
  return (49 * columns + 8 * cabinets) / 100;
}

/** Aggregate capacity over the first `n` picks of a scenario. */
export function networkCapacity(
  scenario: NetworkScenario,
  n: number,
  cap: CapacityDefaults,
  oohShare: number,
): { columns: number; cabinets: number; meters: number; parcelsPerDay: number } {
  let columns = 0;
  let cabinets = 0;
  let meters = 0;
  let ppd = 0;
  for (let i = 0; i < Math.min(n, scenario.picks.length); i++) {
    const cols = columnsNeeded(scenario.picks[i].gain, cap, oohShare);
    columns += cols;
    cabinets += cabinetsNeeded(cols, cap);
    meters += metersNeeded(cols, cap);
    ppd += parcelsPerDay(scenario.picks[i].gain, cap, oohShare);
  }
  return { columns, cabinets, meters, parcelsPerDay: ppd };
}

/** Same locker set as the Python pipeline (compute_population_coverage.py). */
export const LOCKER_TYPES = new Set([
  'packStation', 'automaat', 'dpd_box', 'locker', 'Buitenkluis',
]);

/** Carrier brand colours for existing-point markers (matches the 3D view). */
export const CARRIER_COLORS: Record<string, string> = {
  postnl: '#ff6200',
  dhl: '#ffcc00',
  dpd: '#dc0032',
  amazon: '#ff9900',
  vintedgo: '#09b1ba',
  deburen: '#7c3aed',
  gls: '#06038d',
  inpost: '#ffcd00',
  viatim: '#e11d48',
  budbee: '#1f9d55',
};
export function carrierColor(v: string): string {
  return CARRIER_COLORS[v.toLowerCase().replace(/[^a-z]/g, '')] ?? '#475569';
}

export function scenarioKey(distance: number, start: string): string {
  return `${distance}|${start}`;
}

export const nlInt = (n: number) =>
  n.toLocaleString('nl-NL', { maximumFractionDigits: 0 });
export const nlPct1 = (n: number) =>
  n.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
