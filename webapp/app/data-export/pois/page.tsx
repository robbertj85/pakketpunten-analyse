'use client';

import dynamic from 'next/dynamic';

const PoiExplorer = dynamic(() => import('@/components/PoiExplorer'), {
  ssr: false,
  loading: () => (
    <div className="bg-white rounded-lg shadow-md p-12 text-center text-gray-500">
      Kaart laden…
    </div>
  ),
});

export default function PoisPage() {
  return (
    <>
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-900">Publieke POI&apos;s</h2>
        <p className="text-sm text-gray-600">
          OV-locaties, publieke gebouwen, onderwijs en voorzieningen uit OpenStreetMap.
          Schakel layers in via de zijbalk. Activeer &laquo;Toon pijnpunten&raquo; om de
          carrier-/gemeente-pijnpunten op PC4-niveau te overlayen — klik op een PC4 om de
          POI&apos;s in dat gebied te zien.
        </p>
      </div>
      <PoiExplorer />
    </>
  );
}
