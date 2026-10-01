/**
 * The single source of truth for carriers: order, series colours, brand chrome.
 *
 * This replaces four near-identical inline tables (Map, NearestPointsFinder and
 * the three history modals). They had drifted: GLS was drawn navy in one place
 * and yellow in another, and — worse — DHL (#FFCC00) and InPost (#FFCD00) were
 * one step apart in the green channel, which is to say identical. Both appeared
 * in the same pie and the same ten-line chart.
 *
 * ## Two kinds of colour, deliberately kept apart
 *
 * `brand` is the carrier's real livery. It is used only where a logo sits on
 * top of it — the map pins. There the logo carries identity and the colour is
 * decoration, so brand accuracy costs nothing.
 *
 * `series` is a validated categorical palette used everywhere identity comes
 * from colour alone: charts, legends and the bare circle markers the map falls
 * back to above ~3000 points. Real brand colours cannot do this job. Ten
 * liveries include three near-identical yellows and two oranges; no amount of
 * care makes them separable.
 *
 * ## How the series palette was chosen
 *
 * Eleven hues in a fixed order, validated with the dataviz validator against
 * the *adjacent* pairlist (the relevant one for lines, bars and stacks). The
 * eleventh (FedEx, purple, added last) was re-validated on the full list of 11:
 *
 *   light  worst adjacent CVD ΔE 7.2 (green↔red, protan; tritan 10.3)
 *          worst adjacent normal-vision ΔE 22.1 — passes the ≥15 floor
 *   dark   worst adjacent CVD ΔE 8.6 · worst normal-vision ΔE 17.8 — all pass
 *
 * FedEx was also checked against every other hue, not just its neighbour: its
 * nearest is VintedGo's violet at normal-vision ΔE 16.4 (light) and ViaTim at
 * 15.6 (dark), both above the 15 floor.
 *
 * Light-mode CVD lands in the 6–8 band, which is permissible **only with
 * secondary encoding**. That is not optional here: every chart using these
 * colours must also carry a legend and direct labels. Ten is past the point
 * where hue alone works, and no ordering of ten (let alone eleven) hues
 * clears 8.0.
 *
 * The order is fixed and follows overall carrier size. Do not sort it by the
 * current filter: colour must follow the carrier, never its rank, or filtering
 * repaints the survivors.
 *
 * Under the *all-pairs* gate (any two series compared directly — a pie, a
 * scatter) eleven series cannot pass at all, and neither can eight. Charts of that
 * shape need a different form, not a different palette; see the market-share
 * chart, which is a ranked bar for exactly this reason.
 */

export const CARRIER_ORDER = [
  'PostNL',
  'DHL',
  'DPD',
  'VintedGo',
  'Amazon',
  'GLS',
  'InPost',
  'Budbee',
  'ViaTim',
  'DeBuren',
  'FedEx',
] as const;

export type Carrier = (typeof CARRIER_ORDER)[number];

/** Validated categorical palette, in CARRIER_ORDER. Light surface. */
export const CARRIER_SERIES_COLORS: Record<Carrier, string> = {
  PostNL: '#2a78d6', // blue
  DHL: '#eb6834', // orange
  DPD: '#1baf7a', // aqua
  VintedGo: '#4a3aa7', // violet
  Amazon: '#eda100', // yellow
  GLS: '#0e8f9e', // teal
  InPost: '#e34948', // red
  Budbee: '#008300', // green
  ViaTim: '#e87ba4', // magenta
  DeBuren: '#a1541f', // rust
  FedEx: '#9b4dca', // purple
};

/** The same eleven hues stepped for a dark surface — not an automatic flip. */
export const CARRIER_SERIES_COLORS_DARK: Record<Carrier, string> = {
  PostNL: '#3987e5',
  DHL: '#d95926',
  DPD: '#199e70',
  VintedGo: '#9085e9',
  Amazon: '#c98500',
  GLS: '#0f93a6',
  InPost: '#e66767',
  Budbee: '#008300',
  ViaTim: '#d55181',
  DeBuren: '#c08430',
  FedEx: '#a33ec0',
};

/** Display names. Only DeBuren differs from its key. */
export const CARRIER_LABELS: Record<Carrier, string> = {
  PostNL: 'PostNL',
  DHL: 'DHL',
  DPD: 'DPD',
  VintedGo: 'VintedGo',
  Amazon: 'Amazon',
  GLS: 'GLS',
  InPost: 'InPost',
  Budbee: 'Budbee',
  ViaTim: 'ViaTim',
  DeBuren: 'De Buren',
  FedEx: 'FedEx',
};

interface CarrierBrand {
  /** Livery colour, only for use behind a logo. */
  background: string;
  /** Optional second livery colour, used as a pin border. */
  borderColor?: string;
  logoUrl: string;
}

/** Real brand liveries — map pins only, where the logo carries identity. */
export const CARRIER_BRAND: Record<Carrier, CarrierBrand> = {
  PostNL: { background: '#FF6600', logoUrl: '/logos/postnl.svg' },
  DHL: { background: '#FFCC00', borderColor: '#D40511', logoUrl: '/logos/dhl.svg' },
  DPD: { background: '#DC0032', logoUrl: '/logos/dpd.svg' },
  VintedGo: { background: '#09B1BA', logoUrl: '/logos/vintedgo.svg' },
  Amazon: { background: '#FF9900', borderColor: '#146EB4', logoUrl: '/logos/amazon.svg' },
  GLS: { background: '#FFC600', borderColor: '#003C7E', logoUrl: '/logos/gls.svg' },
  InPost: { background: '#FFCD00', borderColor: '#3B3B3B', logoUrl: '/logos/inpost.svg' },
  Budbee: { background: '#00C389', logoUrl: '/logos/budbee.svg' },
  ViaTim: { background: '#E3007A', logoUrl: '/logos/viatim.svg' },
  DeBuren: { background: '#4CAF50', logoUrl: '/logos/deburen.png' },
  FedEx: { background: '#4D148C', borderColor: '#FF6200', logoUrl: '/logos/fedex.svg' },
};

/** Series colour for a carrier, falling back to a neutral for unknown names. */
export function carrierColor(name: string): string {
  return CARRIER_SERIES_COLORS[name as Carrier] ?? '#888888';
}

export function isKnownCarrier(name: string): name is Carrier {
  return name in CARRIER_SERIES_COLORS;
}

/**
 * Logo path for a carrier, or null when the name is not one we know.
 *
 * The history panels fall back to a colour swatch with the first two letters,
 * so a null here is a rendering choice rather than a missing asset.
 */
export function carrierLogo(name: string): string | null {
  return CARRIER_BRAND[name as Carrier]?.logoUrl ?? null;
}
