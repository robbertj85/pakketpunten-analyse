// Public vs private terrain, identical to inleverpuntenviewer (lib/inleverpuntNetwork.ts)
// so both apps label and colour it the same. Set by scripts/classify_poi_ownership.py;
// a classification of the ground a point stands on, not of legal ownership.

import type { ForecastPick, PlacementHost } from '@/types/forecast';

export type Eigendom = 'publiek' | 'privaat' | 'onbekend';
export type EigendomChoice = 'mix' | 'publiek' | 'privaat';

export const EIGENDOM_LABELS: Record<Eigendom, string> = {
  publiek: 'publiek terrein',
  privaat: 'privaat terrein',
  onbekend: 'terrein onbekend',
};

export const EIGENDOM_COLOURS: Record<Eigendom, string> = {
  publiek: '#2a78d6',
  privaat: '#b45309',
  onbekend: '#7a7f75',
};

export interface LocatedPick {
  pick: ForecastPick;
  host: PlacementHost | null;
  terrain: 'publiek' | 'privaat' | 'onbekend';
  lat: number;
  lon: number;
}

/** Where a pick lands under a terrain choice; null when that terrain has no option. */
export function locatePick(pick: ForecastPick, choice: EigendomChoice): LocatedPick | null {
  if (choice === 'privaat') {
    return pick.privaat ? { pick, host: pick.privaat, terrain: 'privaat', lat: pick.privaat.lat, lon: pick.privaat.lon } : null;
  }
  if (choice === 'publiek') {
    return pick.publiek ? { pick, host: pick.publiek, terrain: 'publiek', lat: pick.publiek.lat, lon: pick.publiek.lon } : null;
  }
  return { pick, host: pick.privaat ?? pick.publiek, terrain: pick.terrein, lat: pick.lat, lon: pick.lon };
}
