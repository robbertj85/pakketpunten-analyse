'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { PakketpuntData, Filters } from '@/types/pakketpunten';
import { CARRIER_ORDER } from '@/lib/carriers';

const MapView = dynamic(() => import('@/components/Map'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-secondary">
      <p className="text-subtle-foreground">Kaart laden...</p>
    </div>
  ),
});

function EmbedContent() {
  const searchParams = useSearchParams();
  const rawParam = searchParams.get('gemeente') || 'zwolle';
  // Map URL alias to internal slug
  const gemeente = rawParam === 'alle-gemeenten' ? 'nederland' : rawParam;

  const [data, setData] = useState<PakketpuntData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const filters = useMemo<Filters>(() => ({
    providers: [...CARRIER_ORDER],
    showBuffer300: true,
    showBuffer400: true,
    showBuffer500: true,
    showBufferFill: true,
    bufferMerged: false,
    showBoundary: false,
    showPC4: false,
    showPainPoints: false,
    showPopulation: false,
    showCoverage: false,
    showSuggestions: false,
    coverageLevel: 'pc4',
    coverageSubset: 'total',
    coverageDistance: '300m',
    coverageScope: 'national',
    useSimpleMarkers: gemeente === 'nederland',
    minOccupancy: 0,
    maxOccupancy: 100,
    showMockData: false,
    pointCategories: ['locker', 'shop'],
    showOnlySharedLocations: false,
    serviceFilters: ['pickup', 'dropoff'],
    poiCategories: [],
    poiIconStyle: 'dots',
  }), [gemeente]);

  useEffect(() => {
    setLoading(true);
    setError(false);
    fetch(`/data/${gemeente}.geojson`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setData(data);
      })
      .catch((err) => {
        console.error('Error loading data:', err);
        setError(true);
      })
      .finally(() => setLoading(false));
  }, [gemeente]);

  const municipalityName = data?.metadata?.gemeente || gemeente;

  return (
    <div className="w-full h-screen relative">
      {error && !data ? (
        <div className="w-full h-full flex items-center justify-center bg-gray-100">
          <p className="text-gray-500">Gemeente niet gevonden</p>
        </div>
      ) : (
        <MapView data={data} filters={filters} />
      )}

      {/* Attribution bar */}
      <div className="absolute bottom-0 left-0 right-0 bg-card/90 backdrop-blur-sm border-t border-border px-3 py-1.5 flex items-center justify-between z-[1000]">
        <span className="text-xs text-muted-foreground">
          {loading
            ? 'Laden...'
            : error && !data
              ? 'Gemeente niet gevonden'
              : `${municipalityName} — Pakketpunten`}
        </span>
        <a
          href={`${typeof window !== 'undefined' ? window.location.origin : ''}/?gemeente=${gemeente === 'nederland' ? 'alle-gemeenten' : gemeente}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary hover:text-primary hover:underline font-medium"
        >
          Open op Pakketpuntenviewer
        </a>
      </div>
    </div>
  );
}

export default function EmbedPage() {
  return (
    <Suspense fallback={
      <div className="w-full h-screen flex items-center justify-center bg-secondary">
        <p className="text-subtle-foreground">Laden...</p>
      </div>
    }>
      <EmbedContent />
    </Suspense>
  );
}
