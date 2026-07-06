'use client';

import { useState } from 'react';
import TrendIndicator from './TrendIndicator';
import MunicipalityHistoryModal from './MunicipalityHistoryModal';
import ProviderHistoryModal from './ProviderHistoryModal';
import TotalOverviewModal from './TotalOverviewModal';
import { HistoryData, MunicipalityHistoryEntry, HistorySnapshot } from '@/types/history';

interface ProviderCounts {
  [provider: string]: number;
}

interface MunicipalityData {
  name: string;
  slug: string;
  providers: ProviderCounts;
  total: number;
}

interface DataMatrixClientProps {
  data: MunicipalityData[];
  providers: string[];
  providerTotals: ProviderCounts;
  grandTotal: number;
  historyData: HistoryData | null;
}

export default function DataMatrixClient({
  data,
  providers,
  providerTotals,
  grandTotal,
  historyData
}: DataMatrixClientProps) {
  const [selectedMunicipality, setSelectedMunicipality] = useState<{
    name: string;
    slug: string;
    history: MunicipalityHistoryEntry[];
  } | null>(null);

  const [selectedProvider, setSelectedProvider] = useState<{
    name: string;
    snapshots: HistorySnapshot[];
  } | null>(null);

  const [showTotalOverview, setShowTotalOverview] = useState(false);

  // Get trend data
  const trend = historyData?.trend;
  const snapshots = historyData?.snapshots || [];
  const latestSnapshot = snapshots[snapshots.length - 1];
  const previousSnapshot = snapshots[snapshots.length - 2];

  // Calculate municipality-level trends
  const getMunicipalityTrend = (slug: string): number | null => {
    if (!historyData?.municipalities[slug]) return null;
    const history = historyData.municipalities[slug].history;
    if (history.length < 2) return null;
    const latest = history[history.length - 1];
    const previous = history[history.length - 2];
    return latest.total - previous.total;
  };

  const handleMunicipalityClick = (municipality: MunicipalityData) => {
    const history = historyData?.municipalities[municipality.slug]?.history || [];
    if (history.length > 0) {
      setSelectedMunicipality({
        name: municipality.name,
        slug: municipality.slug,
        history
      });
    }
  };

  const handleProviderClick = (providerName: string) => {
    if (snapshots.length > 0) {
      setSelectedProvider({
        name: providerName,
        snapshots: snapshots
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Summary Stats with Trends */}
      <div data-tour="overzicht" className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">Overzicht</h2>
          {latestSnapshot && (
            <span className="text-xs text-gray-500">
              Laatste update: {new Date(latestSnapshot.date).toLocaleDateString('nl-NL')}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="text-center p-4 bg-blue-50 rounded-lg">
            <div className="text-2xl font-bold text-blue-900">{data.filter(m => m.slug !== 'nederland').length}</div>
            <div className="text-sm text-blue-700">Gemeenten</div>
          </div>
          <div
            className="group text-center p-4 bg-green-50 rounded-lg cursor-pointer hover:bg-green-100 hover:shadow-md transition-all"
            onClick={() => snapshots.length > 0 && setShowTotalOverview(true)}
          >
            <div className="text-2xl font-bold text-green-900">{grandTotal.toLocaleString('nl-NL')}</div>
            <div className="text-sm text-green-700">Totaal Pakketpunten</div>
            {trend && (
              <div className="mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <TrendIndicator change={trend.change.total} label="week" />
              </div>
            )}
          </div>
          {providers.map(provider => (
            <div
              key={provider}
              className="group text-center p-4 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 hover:shadow-md transition-all"
              onClick={() => handleProviderClick(provider)}
            >
              <div className="text-2xl font-bold text-gray-900">{providerTotals[provider].toLocaleString('nl-NL')}</div>
              <div className="text-sm text-gray-700">{provider}</div>
              {trend?.change.providers[provider] !== undefined && (
                <div className="mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <TrendIndicator change={trend.change.providers[provider]} />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Historical trend summary - visible on hover */}
        {snapshots.length > 1 && (
          <div className="group mt-4 pt-4 border-t border-gray-200 cursor-default">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between text-sm gap-2">
              <span className="text-gray-600">
                Trend over {snapshots.length - 1} weken (sinds {snapshots[0].week_label})
              </span>
              <div className="flex items-center gap-2">
                <span className="text-gray-900 font-medium">
                  {snapshots[0].totals.total.toLocaleString('nl-NL')} → {latestSnapshot?.totals.total.toLocaleString('nl-NL')}
                </span>
                {latestSnapshot && (
                  <span className="opacity-0 group-hover:opacity-100 transition-opacity">
                    <TrendIndicator
                      change={latestSnapshot.totals.total - snapshots[0].totals.total}
                      label="totaal"
                    />
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Data Matrix Table */}
      <div data-tour="matrix-tabel" className="bg-white rounded-lg shadow-md overflow-hidden">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">Pakketpunten per Gemeente en Vervoerder</h2>
          <p className="text-sm text-gray-600 mt-1">
            Klik op een gemeente of vervoerder voor historische ontwikkeling en grafieken
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider sticky left-0 bg-gray-50 z-10">
                  Gemeente
                </th>
                <th className="px-1 py-3 bg-gray-50 w-8">
                  <span className="sr-only">Dashboard</span>
                </th>
                {providers.map(provider => (
                  <th
                    key={provider}
                    className="px-4 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                    onClick={() => handleProviderClick(provider)}
                  >
                    {provider}
                  </th>
                ))}
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-900 uppercase tracking-wider bg-gray-100">
                  Totaal
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  Trend
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {data.map((municipality) => {
                const trend = getMunicipalityTrend(municipality.slug);
                const hasHistory = (historyData?.municipalities[municipality.slug]?.history.length || 0) > 0;

                return (
                  <tr
                    key={municipality.slug}
                    className={`hover:bg-gray-50 ${municipality.slug === 'nederland' ? 'bg-blue-50 font-semibold' : ''} ${hasHistory ? 'cursor-pointer' : ''}`}
                    onClick={() => hasHistory && handleMunicipalityClick(municipality)}
                  >
                    <td className={`px-6 py-4 whitespace-nowrap text-sm text-gray-900 sticky left-0 z-10 ${municipality.slug === 'nederland' ? 'bg-blue-50' : 'bg-white hover:bg-gray-50'}`}>
                      {municipality.name}
                      {municipality.slug === 'nederland' && (
                        <span className="ml-2 text-xs text-blue-600">(Landelijk)</span>
                      )}
                    </td>
                    <td className={`px-1 py-4 text-center ${municipality.slug === 'nederland' ? 'bg-blue-50' : ''}`}>
                      {hasHistory && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMunicipalityClick(municipality);
                          }}
                          className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                          title={`Dashboard ${municipality.name}`}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                          </svg>
                        </button>
                      )}
                    </td>
                    {providers.map(provider => {
                      const count = municipality.providers[provider] || 0;
                      return (
                        <td key={provider} className="px-4 py-4 text-center text-sm">
                          {count > 0 ? (
                            <span className="text-gray-900">{count}</span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-4 py-4 text-center text-sm font-semibold text-gray-900 bg-gray-50">
                      {municipality.total}
                    </td>
                    <td className="px-4 py-4 text-center">
                      {trend !== null ? (
                        <TrendIndicator change={trend} />
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}

              {/* Totals Row */}
              <tr className="bg-gray-100 font-semibold border-t-2 border-gray-300">
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 sticky left-0 bg-gray-100 z-10">
                  TOTAAL
                </td>
                <td className="px-1 py-4 bg-gray-100"></td>
                {providers.map(provider => (
                  <td key={provider} className="px-4 py-4 text-center text-sm text-gray-900">
                    {providerTotals[provider].toLocaleString('nl-NL')}
                  </td>
                ))}
                <td className="px-4 py-4 text-center text-sm text-gray-900 bg-gray-200">
                  {grandTotal.toLocaleString('nl-NL')}
                </td>
                <td className="px-4 py-4 text-center">
                  {trend && <TrendIndicator change={trend.change.total} />}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Legend */}
      <div data-tour="leeswijzer" className="bg-white rounded-lg shadow-md p-6">
        <h3 className="font-semibold text-gray-900 mb-3">Leeswijzer</h3>
        <ul className="text-sm text-gray-700 space-y-2">
          <li className="flex items-center">
            <span className="w-4 h-4 bg-blue-50 border border-blue-200 rounded mr-2"></span>
            <strong className="mr-1">Nederland</strong> - Landelijk overzicht (exacte som van alle gemeentes met boundary filtering)
          </li>
          <li className="flex items-center">
            <span className="text-blue-600 mr-2 cursor-pointer">↗</span>
            <strong className="mr-1">Klikbare rijen</strong> - Klik op een gemeente voor historische data en trends
          </li>
          <li className="flex items-center">
            <svg className="w-4 h-4 text-green-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <strong className="mr-1">Totaal Pakketpunten</strong> - Klik voor marktaandeel en groei van alle vervoerders
          </li>
          <li className="flex items-center">
            <svg className="w-4 h-4 text-blue-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
            <strong className="mr-1">Klikbare vervoerders</strong> - Klik op een vervoerdernaam voor historische data en grafieken
          </li>
          <li className="flex items-center">
            <TrendIndicator change={5} />
            <span className="ml-2"><strong className="mr-1">Trend</strong> - Verandering ten opzichte van vorige week</span>
          </li>
          <li className="flex items-center">
            <span className="text-gray-400 mr-2">-</span>
            Geen pakketpunten van deze vervoerder in gemeente
          </li>
        </ul>
      </div>

      {/* Municipality History Modal */}
      {selectedMunicipality && (
        <MunicipalityHistoryModal
          isOpen={true}
          onClose={() => setSelectedMunicipality(null)}
          municipalityName={selectedMunicipality.name}
          municipalitySlug={selectedMunicipality.slug}
          history={selectedMunicipality.history}
        />
      )}

      {/* Provider History Modal */}
      {selectedProvider && (
        <ProviderHistoryModal
          isOpen={true}
          onClose={() => setSelectedProvider(null)}
          providerName={selectedProvider.name}
          snapshots={selectedProvider.snapshots}
        />
      )}

      {/* Total Overview Modal */}
      {showTotalOverview && (
        <TotalOverviewModal
          isOpen={true}
          onClose={() => setShowTotalOverview(false)}
          snapshots={snapshots}
          providers={providers}
        />
      )}
    </div>
  );
}
