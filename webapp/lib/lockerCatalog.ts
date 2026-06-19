// Standard parcel-locker catalogue.
//
// Source: the carrier "Maak een keuze voor een type automaat" sizing table.
// Every automaat is a single bank of lockers with a fixed height (201 cm) and
// depth (89 cm); only the width grows with the number of columns. The width
// follows B = 49 * kolcommen + 8 (cm) across the published rows (4 kol -> 204,
// 17 kol -> 841), and the locker count grows ~9-10 per added column.
//
// All dimensions are stored in **centimetres** to match the reference table;
// convert to metres (÷100) for the three.js scene, which uses metres as its
// world unit.

export interface LockerSpec {
  /** Number of vertical columns of lockers. */
  columns: number;
  /** Total individual lockers (compartments). */
  lockers: number;
  /** Width B in centimetres. */
  widthCm: number;
  /** Height H in centimetres. */
  heightCm: number;
  /** Depth D in centimetres. */
  depthCm: number;
}

// Published rows from the carrier table (Lockers column is the official count).
const LOCKER_COUNTS: Record<number, number> = {
  4: 33,
  5: 43,
  6: 52,
  7: 62,
  8: 71,
  9: 81,
  10: 90,
  11: 100,
  12: 109,
  13: 119,
  14: 128,
  15: 138,
  16: 147,
  17: 157,
};

export const LOCKER_HEIGHT_CM = 201;
export const LOCKER_DEPTH_CM = 89;
export const MIN_COLUMNS = 4;
export const MAX_COLUMNS = 17;

/** Width in cm for a given column count, following B = 49 * kol + 8. */
export function lockerWidthCm(columns: number): number {
  return 49 * columns + 8;
}

/** Build the full spec for a given column count (clamped to the valid range). */
export function lockerSpec(columns: number): LockerSpec {
  const cols = Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, Math.round(columns)));
  return {
    columns: cols,
    lockers: LOCKER_COUNTS[cols] ?? Math.round(9.3 * cols - 4),
    widthCm: lockerWidthCm(cols),
    heightCm: LOCKER_HEIGHT_CM,
    depthCm: LOCKER_DEPTH_CM,
  };
}

/** The full catalogue as an ordered array (4..17 columns). */
export const LOCKER_CATALOG: LockerSpec[] = Array.from(
  { length: MAX_COLUMNS - MIN_COLUMNS + 1 },
  (_, i) => lockerSpec(MIN_COLUMNS + i),
);

/**
 * Where the branding sits on the cabinet — derived from real NL locker photos:
 *  - 'fullWrap'   : whole front in the brand colour, big logo decal (PostNL).
 *  - 'topHeader'  : neutral/brand body, accent header band across the top.
 *  - 'leftPanel'  : accent panel down the left side, full height.
 *  - 'minimal'    : neutral cabinet, small logo tile top-left (DPD, white label).
 */
export type BrandingStyle = 'fullWrap' | 'topHeader' | 'leftPanel' | 'minimal';

/** Carrier presets for the locker skin. */
export interface CarrierSkin {
  id: string;
  label: string;
  /** Cabinet + door colour. */
  body: string;
  /** Branding / accent colour (header band, side panel, logo tile). */
  accent: string;
  /** Touchscreen colour. */
  screen: string;
  branding: BrandingStyle;
  /** Logo asset in /public/logos, drawn onto the branding area. */
  logo?: string;
}

// White label first — that is the target product. The 10 carriers follow,
// styled from real Dutch locker photography (see notes in the body/accent
// choices: DPD is grey-bodied, De Buren is red/white, Budbee NL is blue).
export const CARRIER_SKINS: CarrierSkin[] = [
  { id: 'whitelabel', label: 'White label', body: '#e6e8eb', accent: '#64748b', screen: '#0b1220', branding: 'minimal' },
  { id: 'postnl', label: 'PostNL', body: '#ff6600', accent: '#ffffff', screen: '#11161f', branding: 'fullWrap', logo: '/logos/postnl.svg' },
  { id: 'dhl', label: 'DHL', body: '#ffcc00', accent: '#d40511', screen: '#2b2f36', branding: 'topHeader', logo: '/logos/dhl.svg' },
  { id: 'dpd', label: 'DPD', body: '#c7c9cb', accent: '#dc0032', screen: '#1f2937', branding: 'minimal', logo: '/logos/dpd.svg' },
  { id: 'vintedgo', label: 'Vinted Go', body: '#0e7a82', accent: '#ffffff', screen: '#06343a', branding: 'topHeader', logo: '/logos/vintedgo.svg' },
  { id: 'amazon', label: 'Amazon Hub', body: '#232f3e', accent: '#ff9900', screen: '#0b1018', branding: 'leftPanel', logo: '/logos/amazon.svg' },
  { id: 'gls', label: 'GLS', body: '#f2f2f0', accent: '#003c7e', screen: '#11161f', branding: 'topHeader', logo: '/logos/gls.svg' },
  { id: 'viatim', label: 'ViaTim', body: '#f4f4f4', accent: '#e3007a', screen: '#11161f', branding: 'topHeader', logo: '/logos/viatim.svg' },
  { id: 'inpost', label: 'InPost', body: '#3b3b3b', accent: '#ffcd00', screen: '#0b1018', branding: 'leftPanel', logo: '/logos/inpost.svg' },
  { id: 'budbee', label: 'Budbee', body: '#1e8fd5', accent: '#00c389', screen: '#0b1018', branding: 'topHeader', logo: '/logos/budbee.svg' },
  { id: 'deburen', label: 'De Buren', body: '#f2f2f2', accent: '#e2231a', screen: '#11161f', branding: 'leftPanel', logo: '/logos/deburen.png' },
];
