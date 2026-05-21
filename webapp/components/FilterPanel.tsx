'use client';

import { useState, useEffect } from 'react';
import {
  Filters, PointCategory, ServiceFilter, getCategoryLabel,
  CoverageLevel, CoverageSubset, CoverageDistance, CoverageScope,
} from '@/types/pakketpunten';
import { BoundaryLoadProgress } from '@/utils/boundaryLoader';

interface PoiCategoryMeta {
  slug: string;
  label: string;
  group: 'ov' | 'publiek' | 'onderwijs' | 'voorzieningen';
  color: string;
  count: number;
}

const POI_GROUP_LABEL: Record<PoiCategoryMeta['group'], string> = {
  ov: 'OV-locaties',
  publiek: 'Publieke gebouwen',
  onderwijs: 'Onderwijs',
  voorzieningen: 'Voorzieningen',
};
const POI_GROUP_ORDER: PoiCategoryMeta['group'][] = ['ov', 'publiek', 'onderwijs', 'voorzieningen'];

function PoiSection({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  const [open, setOpen] = useState(false);
  const [categories, setCategories] = useState<PoiCategoryMeta[]>([]);
  useEffect(() => {
    if (!open || categories.length > 0) return;
    fetch('/data/poi/index.json')
      .then((r) => r.json())
      .then((d) => setCategories(d.categories || []))
      .catch((err) => console.error('POI index load failed:', err));
  }, [open, categories.length]);

  const active = new Set(filters.poiCategories);
  const toggle = (slug: string) => {
    const next = new Set(active);
    if (next.has(slug)) next.delete(slug); else next.add(slug);
    onChange({ ...filters, poiCategories: [...next] });
  };
  const groups: Record<string, PoiCategoryMeta[]> = {};
  categories.forEach((c) => { (groups[c.group] ||= []).push(c); });

  const summary = active.size > 0
    ? `${active.size} actief`
    : 'Geen actief';

  return (
    <div className="border border-gray-200 rounded">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-2 py-1.5 text-left text-sm font-medium text-gray-900 hover:bg-gray-50 flex items-center justify-between"
      >
        <span className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-teal-500" />
          POI&apos;s (OV, scholen, …)
        </span>
        <span className="text-xs text-gray-500">{summary} {open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="px-2 pb-2 space-y-2 max-h-72 overflow-y-auto">
          <div className="flex items-center justify-between pt-1">
            <div className="inline-flex rounded border border-gray-200 overflow-hidden text-xs">
              <button
                type="button"
                className={`px-2 py-0.5 ${filters.poiIconStyle === 'dots' ? 'bg-teal-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                onClick={() => onChange({ ...filters, poiIconStyle: 'dots' })}
              >
                Dots
              </button>
              <button
                type="button"
                className={`px-2 py-0.5 ${filters.poiIconStyle === 'icons' ? 'bg-teal-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                onClick={() => onChange({ ...filters, poiIconStyle: 'icons' })}
              >
                Iconen
              </button>
            </div>
            {active.size > 0 && (
              <button
                type="button"
                className="text-xs text-blue-600 hover:text-blue-800"
                onClick={() => onChange({ ...filters, poiCategories: [] })}
              >
                Alles uit
              </button>
            )}
          </div>
          {POI_GROUP_ORDER.map((group) => {
            const list = groups[group] || [];
            if (list.length === 0) return null;
            return (
              <div key={group}>
                <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-0.5">
                  {POI_GROUP_LABEL[group]}
                </div>
                <div className="space-y-0.5">
                  {list.map((c) => (
                    <label key={c.slug} className="flex items-center gap-2 cursor-pointer text-xs px-1 py-0.5 rounded hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={active.has(c.slug)}
                        onChange={() => toggle(c.slug)}
                        className="w-4 h-4"
                      />
                      <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: c.color }} />
                      <span className="flex-1 text-gray-800">{c.label}</span>
                      <span className="text-gray-400 tabular-nums">{c.count.toLocaleString('nl-NL')}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
          {categories.length === 0 && (
            <div className="text-xs text-gray-500 py-2">Laden…</div>
          )}
        </div>
      )}
    </div>
  );
}

interface FilterPanelProps {
  filters: Filters;
  onChange: (filters: Filters) => void;
  availableProviders?: string[];
  providerCounts?: Record<string, number>;
  categoryCounts?: Record<PointCategory, number>;
  serviceCounts?: Record<ServiceFilter, number>;
  sharedLocationCount?: number;
  boundariesLoading?: boolean;
  boundaryLoadProgress?: BoundaryLoadProgress | null;
  totalPoints?: number;
}

const PROVIDER_INFO = {
  DHL: { name: 'DHL', color: '#FFCC00', textColor: '#D40511' },
  PostNL: { name: 'PostNL', color: '#FF6600', textColor: '#FFFFFF' },
  VintedGo: { name: 'VintedGo', color: '#09B1BA', textColor: '#FFFFFF' },
  DeBuren: { name: 'De Buren', color: '#4CAF50', textColor: '#FFFFFF' },
  Amazon: { name: 'Amazon', color: '#FF9900', textColor: '#146EB4' },
  DPD: { name: 'DPD', color: '#DC0032', textColor: '#FFFFFF' },
  GLS: { name: 'GLS', color: '#003C7E', textColor: '#FFC600' },
  ViaTim: { name: 'ViaTim', color: '#E3007A', textColor: '#FFFFFF' },
  InPost: { name: 'InPost', color: '#FFCD00', textColor: '#3B3B3B' },
  Budbee: { name: 'Budbee', color: '#00C389', textColor: '#FFFFFF' },
};

const CATEGORY_INFO: Record<PointCategory, { name: string }> = {
  locker: { name: 'Pakketautomaat' },
  shop: { name: 'Pakketpunt' },
};

const SERVICE_INFO: Record<ServiceFilter, { name: string; description: string }> = {
  pickup: { name: 'Ophalen', description: 'Pakket ophalen' },
  dropoff: { name: 'Verzenden', description: 'Pakket versturen' },
};

// Icon components for point categories
function LockerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  );
}

function ShopIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z" />
    </svg>
  );
}

function SharedLocationIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 7v.01M9.5 9l.01.01M14.5 9l.01.01M9.5 12l.01.01M14.5 12l.01.01" />
    </svg>
  );
}

// Package with arrow down icon for pickup (receive package)
function PickupIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      {/* Box outline */}
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0v10l-8 4m8-14l-8 4m-8-4v10l8 4m-8-14l8 4" />
      {/* Down arrow */}
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v5m0 0l-2-2m2 2l2-2" />
    </svg>
  );
}

// Package with arrow up icon for dropoff (send package)
function DropoffIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      {/* Box outline */}
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0v10l-8 4m8-14l-8 4m-8-4v10l8 4m-8-14l8 4" />
      {/* Up arrow */}
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 13V8m0 0l-2 2m2-2l2 2" />
    </svg>
  );
}

// Inline loading spinner component (grey, matching top bar)
function InlineSpinner() {
  return (
    <svg className="animate-spin h-3.5 w-3.5 text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
  );
}

export default function FilterPanel({ filters, onChange, availableProviders, providerCounts, categoryCounts, serviceCounts, sharedLocationCount, boundariesLoading, boundaryLoadProgress, totalPoints }: FilterPanelProps) {
  const buffersDisabled = (totalPoints ?? 0) > 3000;

  // Local spinner state for merged buffer toggle
  const [mergeSpinner, setMergeSpinner] = useState(false);
  // Local spinner state for "toggle all providers" header click
  const [providersSpinner, setProvidersSpinner] = useState(false);

  // Clear spinner once the filter change has been applied (computation done, re-render complete)
  useEffect(() => {
    if (filters.bufferMerged && mergeSpinner) {
      setMergeSpinner(false);
    }
  }, [filters.bufferMerged, mergeSpinner]);

  // Clear providers spinner once provider list has been applied, but keep it
  // visible for a minimum duration so fast re-renders don't cause it to flash
  useEffect(() => {
    if (!providersSpinner) return;
    const t = setTimeout(() => setProvidersSpinner(false), 400);
    return () => clearTimeout(t);
  }, [filters.providers, providersSpinner]);

  const toggleProvider = (provider: string) => {
    const newProviders = filters.providers.includes(provider)
      ? filters.providers.filter((p) => p !== provider)
      : [...filters.providers, provider];

    onChange({ ...filters, providers: newProviders });
  };

  const toggleCategory = (category: PointCategory) => {
    const newCategories = filters.pointCategories.includes(category)
      ? filters.pointCategories.filter((c) => c !== category)
      : [...filters.pointCategories, category];

    onChange({ ...filters, pointCategories: newCategories });
  };

  const toggleService = (service: ServiceFilter) => {
    const newServices = filters.serviceFilters.includes(service)
      ? filters.serviceFilters.filter((s) => s !== service)
      : [...filters.serviceFilters, service];

    onChange({ ...filters, serviceFilters: newServices });
  };

  const providers = availableProviders || Object.keys(PROVIDER_INFO);
  const categories: PointCategory[] = ['locker', 'shop'];
  const services: ServiceFilter[] = ['pickup', 'dropoff'];

  return (
    <div className="space-y-4 md:space-y-6 p-3 md:p-4 bg-white rounded-lg shadow-md">
      <div>
        <h3 className="text-base md:text-lg font-semibold text-gray-900 mb-2 md:mb-3">Filters</h3>
      </div>

      {/* Provider filters */}
      <div>
        <button
          type="button"
          onClick={() => {
            const next = filters.providers.length > 0 ? [] : providers;
            setProvidersSpinner(true);
            // Defer so the browser paints the spinner before heavy re-render
            setTimeout(() => onChange({ ...filters, providers: next }), 20);
          }}
          className="flex items-center gap-2 w-full text-left text-sm font-medium text-gray-900 mb-2 hover:text-blue-600 transition cursor-pointer select-none"
          title={filters.providers.length > 0 ? 'Alle uitschakelen' : 'Alle inschakelen'}
        >
          <span>Vervoerders</span>
          {providersSpinner && <InlineSpinner />}
        </button>
        <div className="space-y-1 md:space-y-2">
          {providers.map((provider) => {
            const info = PROVIDER_INFO[provider as keyof typeof PROVIDER_INFO];
            if (!info) return null;

            const isSelected = filters.providers.includes(provider);
            const count = providerCounts?.[provider] || 0;

            return (
              <label key={provider} className="flex items-center space-x-2 cursor-pointer py-1.5 md:py-0.5 -mx-1 px-1 rounded hover:bg-gray-50 active:bg-gray-100 transition">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleProvider(provider)}
                  className="w-5 h-5 md:w-4 md:h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                />
                <span
                  className="w-4 h-4 rounded-full border border-white flex-shrink-0"
                  style={{ backgroundColor: info.color }}
                />
                <span className="text-sm text-gray-900 flex-1">{info.name}</span>
                {isSelected && count > 0 && (
                  <span className="text-sm font-semibold text-gray-900 ml-auto tabular-nums">
                    {count}
                  </span>
                )}
              </label>
            );
          })}
        </div>
      </div>

      {/* Point category filters */}
      <div>
        <label className="block text-sm font-medium text-gray-900 mb-2">Type locatie</label>
        <div className="space-y-1 md:space-y-2">
          {categories.map((category) => {
            const info = CATEGORY_INFO[category];
            const isSelected = filters.pointCategories.includes(category);
            const count = categoryCounts?.[category] || 0;

            return (
              <label key={category} className="flex items-center space-x-2 cursor-pointer py-1.5 md:py-0.5 -mx-1 px-1 rounded hover:bg-gray-50 active:bg-gray-100 transition">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleCategory(category)}
                  className="w-5 h-5 md:w-4 md:h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                />
                {category === 'locker' ? (
                  <LockerIcon className="w-4 h-4 text-gray-600 flex-shrink-0" />
                ) : (
                  <ShopIcon className="w-4 h-4 text-gray-600 flex-shrink-0" />
                )}
                <span className="text-sm text-gray-900 flex-1">{info.name}</span>
                {isSelected && count > 0 && (
                  <span className="text-sm font-semibold text-gray-900 ml-auto tabular-nums">
                    {count}
                  </span>
                )}
              </label>
            );
          })}
        </div>
      </div>

      {/* Service capability filters */}
      <div>
        <label className="block text-sm font-medium text-gray-900 mb-2">Service</label>
        <div className="space-y-1 md:space-y-2">
          {services.map((service) => {
            const info = SERVICE_INFO[service];
            const isSelected = filters.serviceFilters.includes(service);
            const count = serviceCounts?.[service] || 0;

            return (
              <label key={service} className="flex items-center space-x-2 cursor-pointer py-1.5 md:py-0.5 -mx-1 px-1 rounded hover:bg-gray-50 active:bg-gray-100 transition">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleService(service)}
                  className="w-5 h-5 md:w-4 md:h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                />
                {service === 'pickup' ? (
                  <PickupIcon className="w-4 h-4 text-gray-600 flex-shrink-0" />
                ) : (
                  <DropoffIcon className="w-4 h-4 text-gray-600 flex-shrink-0" />
                )}
                <span className="text-sm text-gray-900 flex-1">{info.name}</span>
                {isSelected && count > 0 && (
                  <span className="text-sm font-semibold text-gray-900 ml-auto tabular-nums">
                    {count}
                  </span>
                )}
              </label>
            );
          })}
        </div>
        <p className="text-xs text-gray-500 mt-1">Ophalen = pakket ontvangen, Verzenden = pakket versturen</p>
      </div>

      {/* Shared locations filter */}
      <div>
        <label className="block text-sm font-medium text-gray-900 mb-2">Locaties</label>
        <div className="space-y-1 md:space-y-2">
          <label className="flex items-center space-x-2 cursor-pointer py-1.5 md:py-0.5 -mx-1 px-1 rounded hover:bg-gray-50 active:bg-gray-100 transition">
            <input
              type="radio"
              name="locationFilter"
              checked={!filters.showOnlySharedLocations}
              onChange={() => onChange({ ...filters, showOnlySharedLocations: false })}
              className="w-5 h-5 md:w-4 md:h-4 text-blue-600 focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-900">Alle locaties</span>
          </label>
          <label className="flex items-center space-x-2 cursor-pointer py-1.5 md:py-0.5 -mx-1 px-1 rounded hover:bg-gray-50 active:bg-gray-100 transition">
            <input
              type="radio"
              name="locationFilter"
              checked={filters.showOnlySharedLocations}
              onChange={() => onChange({ ...filters, showOnlySharedLocations: true })}
              className="w-5 h-5 md:w-4 md:h-4 text-blue-600 focus:ring-2 focus:ring-blue-500"
            />
            <SharedLocationIcon className="w-4 h-4 text-gray-600 flex-shrink-0" />
            <span className="text-sm text-gray-900 flex-1">Gedeelde adressen</span>
            {filters.showOnlySharedLocations && sharedLocationCount !== undefined && sharedLocationCount > 0 && (
              <span className="text-sm font-semibold text-gray-900 ml-auto tabular-nums">
                {sharedLocationCount}
              </span>
            )}
          </label>
          <p className="text-xs text-gray-500 ml-7">Adressen met meerdere vervoerders</p>
        </div>
      </div>

      {/* Marker Style */}
      <div>
        <label className="block text-sm font-medium text-gray-900 mb-2">Markering weergave</label>
        <div className="space-y-1 md:space-y-2">
          <label className="flex items-center space-x-2 cursor-pointer py-1.5 md:py-0.5 -mx-1 px-1 rounded hover:bg-gray-50 active:bg-gray-100 transition">
            <input
              type="radio"
              name="markerStyle"
              checked={!filters.useSimpleMarkers}
              onChange={() => onChange({ ...filters, useSimpleMarkers: false })}
              className="w-5 h-5 md:w-4 md:h-4 text-blue-600 focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-900">Logo iconen</span>
          </label>
          <label className="flex items-center space-x-2 cursor-pointer py-1.5 md:py-0.5 -mx-1 px-1 rounded hover:bg-gray-50 active:bg-gray-100 transition">
            <input
              type="radio"
              name="markerStyle"
              checked={filters.useSimpleMarkers}
              onChange={() => onChange({ ...filters, useSimpleMarkers: true })}
              className="w-5 h-5 md:w-4 md:h-4 text-blue-600 focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-900">Gekleurde stippen</span>
          </label>
        </div>
      </div>

      {/* Buffer zones */}
      <div>
        <label className="block text-sm font-medium text-gray-900 mb-2">Dekkingsgebieden</label>
        <div className="space-y-1 md:space-y-2">
          <label className={`flex items-center space-x-2 py-1.5 md:py-0.5 -mx-1 px-1 rounded transition ${buffersDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50 active:bg-gray-100'}`}>
            <input
              type="checkbox"
              checked={filters.showBuffer300}
              onChange={(e) => onChange({ ...filters, showBuffer300: e.target.checked })}
              disabled={buffersDisabled}
              className="w-5 h-5 md:w-4 md:h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            />
            <span className="text-sm text-gray-900">300m buffer lijn</span>
          </label>
          <label className={`flex items-center space-x-2 py-1.5 md:py-0.5 -mx-1 px-1 rounded transition ${buffersDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50 active:bg-gray-100'}`}>
            <input
              type="checkbox"
              checked={filters.showBuffer400}
              onChange={(e) => onChange({ ...filters, showBuffer400: e.target.checked })}
              disabled={buffersDisabled}
              className="w-5 h-5 md:w-4 md:h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            />
            <span className="text-sm text-gray-900">400m buffer lijn</span>
          </label>
          <label className={`flex items-center space-x-2 py-1.5 md:py-0.5 -mx-1 px-1 rounded transition ${buffersDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50 active:bg-gray-100'}`}>
            <input
              type="checkbox"
              checked={filters.showBufferFill}
              onChange={(e) => onChange({ ...filters, showBufferFill: e.target.checked })}
              disabled={buffersDisabled}
              className="w-5 h-5 md:w-4 md:h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            />
            <span className="text-sm text-gray-900">Buffer opvulling</span>
          </label>
          <label className={`flex items-center space-x-2 py-1.5 md:py-0.5 -mx-1 px-1 rounded transition ${buffersDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50 active:bg-gray-100'}`}>
            <input
              type="checkbox"
              checked={filters.bufferMerged || mergeSpinner}
              onChange={(e) => {
                const checked = e.target.checked;
                if (checked) {
                  // Show spinner first, defer filter change so browser paints spinner before useMemo blocks
                  setMergeSpinner(true);
                  setTimeout(() => onChange({ ...filters, bufferMerged: true }), 20);
                } else {
                  onChange({ ...filters, bufferMerged: false });
                }
              }}
              disabled={buffersDisabled}
              className="w-5 h-5 md:w-4 md:h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            />
            <span className="text-sm text-gray-900">Samengevoegde buffers</span>
            {mergeSpinner && <InlineSpinner />}
            <span className="relative group/tip">
              <span className="inline-flex items-center justify-center w-4 h-4 text-[10px] font-medium text-gray-400 bg-gray-100 rounded-full cursor-help">i</span>
              <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover/tip:block w-48 px-2 py-1 text-xs text-white bg-gray-800 rounded shadow-lg text-center pointer-events-none z-50">
                Als het laden van pakketpunten traag is, schakel deze instelling uit.
              </span>
            </span>
          </label>
          <label className="flex items-center space-x-2 cursor-pointer py-1.5 md:py-0.5 -mx-1 px-1 rounded hover:bg-gray-50 active:bg-gray-100 transition">
            <input
              type="checkbox"
              checked={filters.showBoundary}
              onChange={(e) => onChange({ ...filters, showBoundary: e.target.checked })}
              disabled={boundariesLoading}
              className="w-5 h-5 md:w-4 md:h-4 text-red-600 rounded focus:ring-2 focus:ring-red-500 disabled:opacity-50"
            />
            <div className="flex-1">
              <span className="text-sm text-gray-900">Gemeentegrens</span>
              {boundariesLoading && boundaryLoadProgress && (
                <div className="mt-1 text-xs text-blue-600">
                  <div className="flex items-center gap-2">
                    <span>Laden: {boundaryLoadProgress.loaded}/{boundaryLoadProgress.total}</span>
                    <span>({boundaryLoadProgress.percentage}%)</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
                    <div
                      className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                      style={{ width: `${boundaryLoadProgress.percentage}%` }}
                    />
                  </div>
                </div>
              )}
              {boundariesLoading && !boundaryLoadProgress && (
                <span className="ml-2 text-xs text-blue-600">(laden...)</span>
              )}
            </div>
          </label>
          <label className="flex items-center space-x-2 cursor-pointer py-1.5 md:py-0.5 -mx-1 px-1 rounded hover:bg-gray-50 active:bg-gray-100 transition">
            <input
              type="checkbox"
              checked={filters.showPC4}
              onChange={(e) => onChange({ ...filters, showPC4: e.target.checked })}
              className="w-5 h-5 md:w-4 md:h-4 text-gray-600 rounded focus:ring-2 focus:ring-gray-500"
            />
            <span className="text-sm text-gray-900">Postcodegebieden (PC4)</span>
          </label>
          <label className="flex items-center space-x-2 cursor-pointer py-1.5 md:py-0.5 -mx-1 px-1 rounded hover:bg-gray-50 active:bg-gray-100 transition">
            <input
              type="checkbox"
              checked={filters.showPainPoints}
              onChange={(e) => onChange({ ...filters, showPainPoints: e.target.checked })}
              className="w-5 h-5 md:w-4 md:h-4 text-violet-700 rounded focus:ring-2 focus:ring-violet-500"
            />
            <span className="w-3 h-3 rounded-sm bg-violet-700/70 border border-violet-900 flex-shrink-0" />
            <span className="text-sm text-gray-900">Pijnpunten vervoerders</span>
          </label>
          <label className="flex items-center space-x-2 cursor-pointer py-1.5 md:py-0.5 -mx-1 px-1 rounded hover:bg-gray-50 active:bg-gray-100 transition">
            <input
              type="checkbox"
              checked={filters.showPopulation}
              onChange={(e) => onChange({ ...filters, showPopulation: e.target.checked })}
              className="w-5 h-5 md:w-4 md:h-4 text-indigo-600 rounded focus:ring-2 focus:ring-indigo-500"
            />
            <span className="w-3 h-3 rounded-sm bg-indigo-500/60 border border-indigo-700 flex-shrink-0" />
            <span className="text-sm text-gray-900">Inwoners per km² (CBS)</span>
          </label>
          <label className="flex items-center space-x-2 cursor-pointer py-1.5 md:py-0.5 -mx-1 px-1 rounded hover:bg-gray-50 active:bg-gray-100 transition">
            <input
              type="checkbox"
              checked={filters.showCoverage}
              onChange={(e) => onChange({ ...filters, showCoverage: e.target.checked })}
              className="w-5 h-5 md:w-4 md:h-4 text-emerald-600 rounded focus:ring-2 focus:ring-emerald-500"
            />
            <span className="w-3 h-3 rounded-sm bg-emerald-500/60 border border-emerald-700 flex-shrink-0" />
            <span className="text-sm text-gray-900">Bereik inwoners (300/400/500m)</span>
          </label>
          <label className="flex items-center space-x-2 cursor-pointer py-1.5 md:py-0.5 -mx-1 px-1 rounded hover:bg-gray-50 active:bg-gray-100 transition">
            <input
              type="checkbox"
              checked={filters.showSuggestions}
              onChange={(e) => onChange({ ...filters, showSuggestions: e.target.checked })}
              className="w-5 h-5 md:w-4 md:h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
            />
            <span className="w-3 h-3 rounded-sm bg-blue-600/70 border border-blue-900 flex-shrink-0" />
            <span className="text-sm text-gray-900">Plaatsingsadvies (top-5 PC4s)</span>
          </label>
          <PoiSection filters={filters} onChange={onChange} />
          {filters.showCoverage && (
            <div className="ml-7 pt-1 pb-1 grid grid-cols-2 gap-2 text-xs">
              <label className="block">
                <span className="text-gray-500">Niveau</span>
                <select
                  value={filters.coverageLevel}
                  onChange={(e) => onChange({ ...filters, coverageLevel: e.target.value as CoverageLevel })}
                  className="mt-0.5 w-full px-2 py-1 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="pc4">PC4</option>
                  <option value="gemeente">Gemeente</option>
                </select>
              </label>
              <label className="block">
                <span className="text-gray-500">Type</span>
                <select
                  value={filters.coverageSubset}
                  onChange={(e) => onChange({ ...filters, coverageSubset: e.target.value as CoverageSubset })}
                  className="mt-0.5 w-full px-2 py-1 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="total">Alle</option>
                  <option value="shop">Shops</option>
                  <option value="locker">Lockers</option>
                </select>
              </label>
              <label className="block">
                <span className="text-gray-500">Afstand</span>
                <select
                  value={filters.coverageDistance}
                  onChange={(e) => onChange({ ...filters, coverageDistance: e.target.value as CoverageDistance })}
                  className="mt-0.5 w-full px-2 py-1 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="300m">300 m</option>
                  <option value="400m">400 m</option>
                  <option value="500m">500 m</option>
                </select>
              </label>
              {filters.coverageLevel === 'gemeente' && (
                <label className="block">
                  <span className="text-gray-500">Bereik</span>
                  <select
                    value={filters.coverageScope}
                    onChange={(e) => onChange({ ...filters, coverageScope: e.target.value as CoverageScope })}
                    className="mt-0.5 w-full px-2 py-1 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="national">Nationaal</option>
                    <option value="strict">Strict (alleen eigen punten)</option>
                  </select>
                </label>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Reset button */}
      <button
        onClick={() =>
          onChange({
            providers: providers,
            showBuffer300: true,
            showBuffer400: true,
            showBufferFill: false,
            bufferMerged: true,
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
            useSimpleMarkers: false,
            minOccupancy: 0,
            maxOccupancy: 100,
            showMockData: false,
            pointCategories: ['locker', 'shop'],
            showOnlySharedLocations: false,
            serviceFilters: ['pickup', 'dropoff'],
            poiCategories: [],
            poiIconStyle: 'dots',
          })
        }
        className="w-full px-4 py-3 md:py-2 text-sm font-medium text-gray-900 bg-gray-100 rounded-lg hover:bg-gray-200 active:bg-gray-300 transition"
      >
        Reset Filters
      </button>
    </div>
  );
}
