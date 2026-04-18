'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { PakketpuntData, Filters } from '@/types/pakketpunten';

const MapView = dynamic(() => import('@/components/Map'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-gray-100">
      <p className="text-gray-500">Kaart laden...</p>
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

  const filters = useMemo<Filters>(() => ({
    providers: ['DHL', 'PostNL', 'VintedGo', 'DeBuren', 'DPD', 'Amazon', 'GLS', 'ViaTim', 'InPost', 'Budbee'],
    showBuffer300: false,
    showBuffer400: false,
    showBufferFill: false,
    bufferMerged: false,
    showBoundary: false,
    showPC4: false,
    showPainPoints: false,
    showPopulation: false,
    useSimpleMarkers: gemeente === 'nederland',
    minOccupancy: 0,
    maxOccupancy: 100,
    showMockData: false,
    pointCategories: ['locker', 'shop'],
    showOnlySharedLocations: false,
    serviceFilters: ['pickup', 'dropoff'],
  }), [gemeente]);

  useEffect(() => {
    setLoading(true);
    fetch(`/data/${gemeente}.geojson`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setData(data);
      })
      .catch((err) => console.error('Error loading data:', err))
      .finally(() => setLoading(false));
  }, [gemeente]);

  const municipalityName = data?.metadata?.gemeente || gemeente;

  return (
    <div className="w-full h-screen relative">
      <MapView data={data} filters={filters} />

      {/* Attribution bar */}
      <div className="absolute bottom-0 left-0 right-0 bg-white/90 backdrop-blur-sm border-t border-gray-200 px-3 py-1.5 flex items-center justify-between z-[1000]">
        <span className="text-xs text-gray-600">
          {loading ? 'Laden...' : `${municipalityName} — Pakketpunten`}
        </span>
        <a
          href={`${typeof window !== 'undefined' ? window.location.origin : ''}/?gemeente=${gemeente === 'nederland' ? 'alle-gemeenten' : gemeente}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-600 hover:text-blue-800 hover:underline font-medium"
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
      <div className="w-full h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-500">Laden...</p>
      </div>
    }>
      <EmbedContent />
    </Suspense>
  );
}
