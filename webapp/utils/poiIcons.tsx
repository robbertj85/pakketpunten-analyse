import { renderToStaticMarkup } from 'react-dom/server';
import {
  Train, TramFront, Bus, Navigation,
  Landmark, Building2, Recycle, Library, HeartPulse, Zap,
  GraduationCap, School2, School,
  Trophy, ShoppingBag, ShoppingCart, Bike, SquareParking, CircleParking,
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
  supermarkt: ShoppingCart,
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

// Carrier branding for logo markers — same styling as the main map's
// detailed markers (components/Map.tsx PROVIDER_INFO): white circle, brand
// border colour, local logo SVG with initials fallback.
const CARRIER_ICON_INFO: Record<string, { border: string; brand: string; logoUrl: string }> = {
  dhl: { border: '#D40511', brand: '#FFCC00', logoUrl: '/logos/dhl.svg' },
  postnl: { border: 'white', brand: '#FF6600', logoUrl: '/logos/postnl.svg' },
  vintedgo: { border: 'white', brand: '#09B1BA', logoUrl: '/logos/vintedgo.svg' },
  deburen: { border: 'white', brand: '#4CAF50', logoUrl: '/logos/deburen.png' },
  amazon: { border: '#146EB4', brand: '#FF9900', logoUrl: '/logos/amazon.svg' },
  dpd: { border: 'white', brand: '#DC0032', logoUrl: '/logos/dpd.svg' },
  gls: { border: '#003C7E', brand: '#003C7E', logoUrl: '/logos/gls.svg' },
  viatim: { border: 'white', brand: '#E3007A', logoUrl: '/logos/viatim.svg' },
  inpost: { border: '#3B3B3B', brand: '#FFCD00', logoUrl: '/logos/inpost.svg' },
  budbee: { border: 'white', brand: '#00C389', logoUrl: '/logos/budbee.svg' },
};

/** Carrier-logo marker exactly like the main map's detailed markers: white
 * circle with brand border and the carrier's logo, initials as fallback.
 * Cached like the POI icons. */
export function makeCarrierLogoDivIcon(vervoerder: string, size = 30): L.DivIcon {
  const slug = vervoerder.toLowerCase().replace(/[^a-z]/g, '');
  const key = `carrier|${slug}|${size}`;
  const cached = ICON_CACHE.get(key);
  if (cached) return cached;

  const info = CARRIER_ICON_INFO[slug] ?? { border: 'white', brand: '#666', logoUrl: '' };
  const logoSize = Math.round(size * 0.65);
  const fontSize = Math.max(9, Math.round(size * 0.3));
  const initials = vervoerder.substring(0, 2);
  const html = `
    <div style="
      width:${size}px;height:${size}px;
      background:white;
      border:2.5px solid ${info.border};
      border-radius:50%;
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 3px 8px rgba(0,0,0,0.4);
      overflow:hidden;
    ">
      <img
        src="${info.logoUrl}"
        alt="${vervoerder}"
        style="width:${logoSize}px;height:${logoSize}px;object-fit:contain;"
        onerror="this.style.display='none'; const div = document.createElement('div'); div.textContent='${initials}'; div.style.cssText='font-size:${fontSize}px;font-weight:bold;color:${info.brand}'; this.parentElement.appendChild(div);"
      />
    </div>
  `;
  const icon = L.divIcon({
    html,
    className: 'custom-marker',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
  ICON_CACHE.set(key, icon);
  return icon;
}
