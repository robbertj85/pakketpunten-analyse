import { renderToStaticMarkup } from 'react-dom/server';
import {
  Train, TramFront, Bus, Navigation,
  Landmark, Building2, Recycle, Library, HeartPulse, Zap,
  GraduationCap, School2, School,
  Trophy, ShoppingBag, Bike, SquareParking, CircleParking,
  MapPin,
} from 'lucide-react';
import L from 'leaflet';

// Category slug → Lucide icon component. Falls back to MapPin for unknowns.
const ICON_FOR_SLUG: Record<string, React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>> = {
  ns_station: Train,
  metro_station: Train,
  tram_halte: TramFront,
  bus_halte: Bus,
  ov_knooppunt: Navigation,
  gemeentehuis: Landmark,
  stadsdeelkantoor: Building2,
  inzamelpunt: Recycle,
  bibliotheek: Library,
  ziekenhuis: HeartPulse,
  transformatorhuisje: Zap,
  universiteit: GraduationCap,
  hogeschool: School2,
  middelbare_school: School,
  sportveld: Trophy,
  winkelcentrum: ShoppingBag,
  fietsenstalling: Bike,
  parkeergarage: SquareParking,
  p_and_r: CircleParking,
};

const ICON_CACHE = new Map<string, L.DivIcon>();

export function makePoiDivIcon(category: string, color: string, size = 22): L.DivIcon {
  const key = `${category}|${color}|${size}`;
  const cached = ICON_CACHE.get(key);
  if (cached) return cached;

  const Icon = ICON_FOR_SLUG[category] || MapPin;
  const inner = renderToStaticMarkup(
    <Icon size={size * 0.6} color="#fff" strokeWidth={2.4} />
  );
  const html = `
    <div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:${color};
      border:1.5px solid white;
      box-shadow:0 1px 3px rgba(0,0,0,0.35);
      display:flex;align-items:center;justify-content:center;
      color:white;
    ">${inner}</div>
  `;
  const icon = L.divIcon({
    html,
    className: 'poi-div-icon',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
  ICON_CACHE.set(key, icon);
  return icon;
}
