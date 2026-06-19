'use client';

import { useEffect, useState } from 'react';

interface LocationInfo {
  lat: number;
  lon: number;
  rdx: number;
  rdy: number;
  address?: {
    weergavenaam?: string;
    straat?: string;
    huisnummer?: string;
    postcode?: string;
    woonplaats?: string;
    gemeente?: string;
    afstandM?: number | null;
  };
  bag?: { pandId?: string | null; verblijfsobjectId?: string | null; nummeraanduidingId?: string | null };
  kadaster?: {
    aanduiding?: string;
    gemeente?: string | null;
    sectie?: string | null;
    perceelnummer?: string | number | null;
    oppervlakteM2?: number | null;
  };
}

interface Props {
  /** The frozen location, or null until the user freezes one. */
  frozen: { lat: number; lon: number } | null;
}

/**
 * Shows the frozen locker location as a set of Dutch reference identifiers and
 * deep-links into external viewers (Google Street View / Maps, Kadaster BAG
 * viewer). The location is captured by the "Locatie vastleggen" button in the
 * config panel; here we resolve the address / BAG / kadaster details via the
 * same-origin /api/locationinfo proxy and render the report.
 */
export default function LocationExportPanel({ frozen }: Props) {
  const [info, setInfo] = useState<LocationInfo | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!frozen) {
      setInfo(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setInfo(null);
    fetch(`/api/locationinfo?lat=${frozen.lat}&lon=${frozen.lon}`)
      .then((r) => r.json())
      .then((j) => !cancelled && setInfo(j))
      .catch(() => !cancelled && setInfo({ lat: frozen.lat, lon: frozen.lon, rdx: 0, rdy: 0 }))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [frozen]);

  return (
    <div className="mt-4 bg-white rounded-lg shadow-md overflow-hidden">
      <div className="px-4 py-2 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900">Vastgelegde locatie</h3>
      </div>

      {!frozen ? (
        <p className="px-4 py-6 text-sm text-gray-500">
          Plaats de automaat op de gewenste plek en klik op{' '}
          <span className="font-medium text-gray-700">Locatie vastleggen</span> in het
          configuratiepaneel om de coördinaten, het adres, BAG-/kadasternummer en
          externe links te genereren.
        </p>
      ) : (
        <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Specs */}
          <div className="space-y-1.5 text-sm">
            <Spec label="Lat / Lon" value={`${frozen.lat.toFixed(6)}, ${frozen.lon.toFixed(6)}`} mono />
            <Spec
              label="RD (EPSG:28992)"
              value={info ? `${Math.round(info.rdx)}, ${Math.round(info.rdy)}` : '…'}
              mono
            />
            <Spec
              label="Dichtstbij adres"
              value={
                loading
                  ? '…'
                  : info?.address
                    ? `${info.address.straat ?? ''} ${info.address.huisnummer ?? ''}, ${
                        info.address.postcode ?? ''
                      } ${info.address.woonplaats ?? ''}`.trim()
                    : 'onbekend'
              }
              hint={info?.address?.afstandM != null ? `±${info.address.afstandM} m` : undefined}
            />
            <Spec label="Gemeente" value={loading ? '…' : info?.address?.gemeente ?? '—'} />
            <Spec
              label="BAG verblijfsobject"
              value={loading ? '…' : info?.bag?.verblijfsobjectId ?? '—'}
              mono
            />
            <Spec
              label="BAG nummeraanduiding"
              value={loading ? '…' : info?.bag?.nummeraanduidingId ?? '—'}
              mono
            />
            <Spec
              label="Kadastraal perceel"
              value={loading ? '…' : info?.kadaster?.aanduiding || '—'}
              hint={info?.kadaster?.oppervlakteM2 != null ? `${info.kadaster.oppervlakteM2} m²` : undefined}
              mono
            />
          </div>

          {/* External viewers */}
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Open in externe viewer
            </p>
            <LinkBtn href={streetViewUrl(frozen.lat, frozen.lon)}>Google Street View</LinkBtn>
            <LinkBtn href={googleSatUrl(frozen.lat, frozen.lon)}>Google Maps (satelliet)</LinkBtn>
            <LinkBtn href={bagViewerUrl(info?.rdx, info?.rdy)}>BAG-viewer (Kadaster)</LinkBtn>
            <LinkBtn href={pdokKaartUrl(frozen.lat, frozen.lon)}>
              Kadastrale kaart / luchtfoto (PDOK)
            </LinkBtn>
          </div>
        </div>
      )}

      <div className="px-4 py-2 text-[11px] text-gray-500 border-t border-gray-100">
        Adres &amp; BAG via PDOK Locatieserver · perceel via PDOK Kadastrale Kaart ·
        coördinaten in WGS84 en RD
      </div>
    </div>
  );
}

/* ----- external viewer URLs (no API keys) ----- */

function streetViewUrl(lat: number, lon: number) {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}`;
}
function googleSatUrl(lat: number, lon: number) {
  return `https://www.google.com/maps/place/${lat},${lon}/@${lat},${lon},90m/data=!3m1!1e3`;
}
function bagViewerUrl(rdx?: number, rdy?: number) {
  if (rdx && rdy)
    return `https://bagviewer.kadaster.nl/lvbag/bag-viewer/#?geometry.x=${Math.round(rdx)}&geometry.y=${Math.round(rdy)}&zoomlevel=11`;
  return 'https://bagviewer.kadaster.nl/lvbag/bag-viewer/';
}
function pdokKaartUrl(lat: number, lon: number) {
  // PDOK's "Kadastrale kaart" viewer centres on a lat,lon hash.
  return `https://app.pdok.nl/kadaster/kadastralekaart/viewer/index.html#@${lat},${lon},19z`;
}

function Spec({
  label,
  value,
  hint,
  mono = false,
}: {
  label: string;
  value: string;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-gray-50 pb-1">
      <span className="text-[11px] uppercase tracking-wide text-gray-400 shrink-0">{label}</span>
      <span className={`text-right text-gray-800 ${mono ? 'font-mono text-xs' : ''}`}>
        {value}
        {hint && <span className="ml-1 text-gray-400">({hint})</span>}
      </span>
    </div>
  );
}

function LinkBtn({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-between px-3 py-2 text-sm font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded"
    >
      {children}
      <span aria-hidden className="text-blue-400 font-normal">&rsaquo;</span>
    </a>
  );
}
