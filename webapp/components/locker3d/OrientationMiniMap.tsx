'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';

interface OrientationMiniMapProps {
  lat: number;
  lon: number;
}

/**
 * Small inset map (OpenStreetMap, with street names) that keeps the user
 * oriented while they explore the 3D scene. A marker shows the suggested
 * location. Built with vanilla Leaflet to avoid react-leaflet/React 19 quirks.
 */
export default function OrientationMiniMap({ lat, lon }: OrientationMiniMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.CircleMarker | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: false,
      scrollWheelZoom: false,
      doubleClickZoom: true,
      dragging: true,
    }).setView([lat, lon], 17);
    mapRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map);

    markerRef.current = L.circleMarker([lat, lon], {
      radius: 7,
      color: '#1d4ed8',
      weight: 2,
      fillColor: '#3b82f6',
      fillOpacity: 0.9,
    }).addTo(map);

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [lat, lon]);

  // Re-centre if the coordinate changes without a remount.
  useEffect(() => {
    if (mapRef.current) mapRef.current.setView([lat, lon]);
    if (markerRef.current) markerRef.current.setLatLng([lat, lon]);
  }, [lat, lon]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      <div className="absolute bottom-0 right-0 px-1 text-[9px] leading-tight bg-white/70 text-gray-600">
        © OpenStreetMap
      </div>
      {/* North indicator (OSM tiles are always north-up). */}
      <div className="absolute top-1 left-1 w-6 h-6 rounded-full bg-white/85 border border-gray-300 flex items-center justify-center text-[10px] font-bold text-gray-700 shadow-sm">
        N
      </div>
    </div>
  );
}
