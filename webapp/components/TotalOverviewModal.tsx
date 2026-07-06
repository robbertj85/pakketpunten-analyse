'use client';

import { HistorySnapshot } from '@/types/history';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell
} from 'recharts';

interface TotalOverviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  snapshots: HistorySnapshot[];
  providers: string[];
}

// Provider colors matching the main app
const PROVIDER_COLORS: { [key: string]: string } = {
  DHL: '#FFCC00',
  PostNL: '#FF6600',
  DPD: '#DC0032',
  VintedGo: '#09B1BA',
  DeBuren: '#4CAF50',
  Amazon: '#FF9900',
  GLS: '#003C7E',
  ViaTim: '#E3007A',
  InPost: '#FFCD00',
  Budbee: '#00C389',
};

// Provider logos
const PROVIDER_LOGOS: { [key: string]: string } = {
  DHL: '/logos/dhl.svg',
  PostNL: '/logos/postnl.svg',
  DPD: '/logos/dpd.svg',
  VintedGo: '/logos/vintedgo.svg',
  DeBuren: '/logos/deburen.png',
  Amazon: '/logos/amazon.svg',
  GLS: '/logos/gls.svg',
  ViaTim: '/logos/viatim.svg',
  InPost: '/logos/inpost.svg',
  Budbee: '/logos/budbee.svg',
};

export default function TotalOverviewModal({
  isOpen,
  onClose,
  snapshots,
  providers
}: TotalOverviewModalProps) {
  if (!isOpen) return null;

  const latestSnapshot = snapshots[snapshots.length - 1];
  const firstSnapshot = snapshots[0];

  // Prepare line chart data for all providers
  const lineChartData = snapshots.map(snapshot => {
    const data: { [key: string]: any } = {
      week: snapshot.week_label,
      date: snapshot.date,
      total: snapshot.totals.total
    };
    providers.forEach(provider => {
      data[provider] = snapshot.totals.providers[provider] || 0;
    });
    return data;
  });

  // Calculate market share for pie chart (latest snapshot)
  const marketShareData = providers.map(provider => ({
    name: provider,
    value: latestSnapshot?.totals.providers[provider] || 0,
    color: PROVIDER_COLORS[provider] || '#888888'
  })).filter(item => item.value > 0).sort((a, b) => b.value - a.value);

  // Calculate growth data for each provider
  const growthData = providers.map(provider => {
    const latestCount = latestSnapshot?.totals.providers[provider] || 0;
    const firstCount = firstSnapshot?.totals.providers[provider] || 0;
    const change = latestCount - firstCount;
    // null = geen baseline (vervoerder was er nog niet in de eerste snapshot)
    const percentageChange = firstCount > 0 ? ((change / firstCount) * 100) : null;
    const marketShare = latestSnapshot?.totals.total > 0
      ? ((latestCount / latestSnapshot.totals.total) * 100)
      : 0;

    return {
      provider,
      current: latestCount,
      initial: firstCount,
      change,
      percentageChange,
      marketShare,
      color: PROVIDER_COLORS[provider] || '#888888'
    };
  }).sort((a, b) => b.current - a.current);

  // Weekly change data for bar chart
  const weeklyChangeData = snapshots.slice(1).map((snapshot, idx) => {
    const prevSnapshot = snapshots[idx];
    const data: { [key: string]: any } = {
      week: snapshot.week_label
    };
    providers.forEach(provider => {
      const current = snapshot.totals.providers[provider] || 0;
      const prev = prevSnapshot.totals.providers[provider] || 0;
      data[provider] = current - prev;
    });
    data.total = snapshot.totals.total - prevSnapshot.totals.total;
    return data;
  });

  // Total statistics
  const totalChange = (latestSnapshot?.totals.total || 0) - (firstSnapshot?.totals.total || 0);
  const totalPercentageChange = firstSnapshot?.totals.total > 0
    ? ((totalChange / firstSnapshot.totals.total) * 100).toFixed(1)
    : '0';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-t-xl sm:rounded-lg shadow-xl w-full sm:max-w-6xl max-h-[85vh] sm:max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex-shrink-0 px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 flex justify-between items-center">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-gray-900">Totaal Overzicht Pakketpunten</h2>
            <p className="text-xs sm:text-sm text-gray-600">Marktaandeel en groei per vervoerder</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 -mr-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition"
            aria-label="Sluiten"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-4 sm:space-y-6">
          {/* Summary stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            <div className="bg-blue-50 rounded-lg p-3 sm:p-4">
              <div className="text-xl sm:text-2xl font-bold text-blue-900">
                {latestSnapshot?.totals.total.toLocaleString('nl-NL') || 0}
              </div>
              <div className="text-xs sm:text-sm text-blue-700">Totaal pakketpunten</div>
            </div>
            <div className={`rounded-lg p-3 sm:p-4 ${totalChange >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
              <div className={`text-xl sm:text-2xl font-bold ${totalChange >= 0 ? 'text-green-900' : 'text-red-900'}`}>
                {totalChange >= 0 ? '+' : ''}{totalChange.toLocaleString('nl-NL')}
              </div>
              <div className={`text-xs sm:text-sm ${totalChange >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                Sinds {firstSnapshot?.week_label}
              </div>
            </div>
            <div className={`rounded-lg p-3 sm:p-4 ${Number(totalPercentageChange) >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
              <div className={`text-xl sm:text-2xl font-bold ${Number(totalPercentageChange) >= 0 ? 'text-green-900' : 'text-red-900'}`}>
                {Number(totalPercentageChange) >= 0 ? '+' : ''}{totalPercentageChange}%
              </div>
              <div className={`text-xs sm:text-sm ${Number(totalPercentageChange) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                Totale groei
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 sm:p-4">
              <div className="text-xl sm:text-2xl font-bold text-gray-900">{providers.length}</div>
              <div className="text-xs sm:text-sm text-gray-700">Vervoerders</div>
            </div>
          </div>

          {/* Market Share and Growth Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
            {/* Pie Chart - Market Share */}
            <div className="bg-white border border-gray-200 rounded-lg p-3 sm:p-4">
              <h3 className="font-semibold text-gray-900 mb-3 sm:mb-4 text-sm sm:text-base">
                Marktaandeel per vervoerder
              </h3>
              <div className="h-48 sm:h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={marketShareData}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="value"
                      label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                      labelLine={false}
                    >
                      {marketShareData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number) => [value.toLocaleString('nl-NL'), 'Pakketpunten']}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Growth Summary per Provider */}
            <div className="bg-white border border-gray-200 rounded-lg p-3 sm:p-4">
              <h3 className="font-semibold text-gray-900 mb-3 sm:mb-4 text-sm sm:text-base">
                Groei per vervoerder
              </h3>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {growthData.map(item => (
                  <div key={item.provider} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-2">
                      {PROVIDER_LOGOS[item.provider] ? (
                        <img
                          src={PROVIDER_LOGOS[item.provider]}
                          alt={item.provider}
                          className="w-6 h-6 object-contain"
                        />
                      ) : (
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
                          style={{ backgroundColor: item.color }}
                        >
                          {item.provider.substring(0, 2)}
                        </div>
                      )}
                      <span className="font-medium text-gray-900 text-sm">{item.provider}</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <span className="text-gray-600">{item.current.toLocaleString('nl-NL')}</span>
                      <span className={`font-medium ${item.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {item.change >= 0 ? '+' : ''}{item.change}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        item.percentageChange == null
                          ? 'bg-gray-100 text-gray-600'
                          : item.percentageChange >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {item.percentageChange == null
                          ? (item.current > 0 ? 'nieuw' : '—')
                          : `${item.percentageChange >= 0 ? '+' : ''}${item.percentageChange.toFixed(1)}%`}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* All Providers Line Chart */}
          <div className="bg-white border border-gray-200 rounded-lg p-3 sm:p-4">
            <h3 className="font-semibold text-gray-900 mb-3 sm:mb-4 text-sm sm:text-base">
              Ontwikkeling alle vervoerders over tijd
            </h3>
            {lineChartData.length > 1 ? (
              <div className="h-64 sm:h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={lineChartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      dataKey="week"
                      tick={{ fontSize: 12 }}
                      tickFormatter={(value) => value?.split('-')[1] || value}
                    />
                    <YAxis tick={{ fontSize: 12 }} domain={['auto', 'auto']} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'white',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                        fontSize: '12px'
                      }}
                      labelFormatter={(label) => `Week ${label}`}
                      formatter={(value: number, name: string) => [value.toLocaleString('nl-NL'), name]}
                    />
                    <Legend />
                    {providers.map(provider => (
                      <Line
                        key={provider}
                        type="monotone"
                        dataKey={provider}
                        name={provider}
                        stroke={PROVIDER_COLORS[provider] || '#888888'}
                        strokeWidth={2}
                        dot={{ fill: PROVIDER_COLORS[provider] || '#888888', strokeWidth: 1, r: 3 }}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-32 flex items-center justify-center text-gray-500 text-sm">
                Onvoldoende historische data beschikbaar om grafiek te tonen
              </div>
            )}
          </div>

          {/* Weekly Changes Stacked Bar Chart */}
          <div className="bg-white border border-gray-200 rounded-lg p-3 sm:p-4">
            <h3 className="font-semibold text-gray-900 mb-3 sm:mb-4 text-sm sm:text-base">
              Wekelijkse verandering per vervoerder
            </h3>
            {weeklyChangeData.length > 0 ? (
              <div className="h-48 sm:h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeklyChangeData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      dataKey="week"
                      tick={{ fontSize: 12 }}
                      tickFormatter={(value) => value?.split('-')[1] || value}
                    />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'white',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                        fontSize: '12px'
                      }}
                      labelFormatter={(label) => `Week ${label}`}
                      formatter={(value: number, name: string) => [
                        `${value >= 0 ? '+' : ''}${value}`,
                        name
                      ]}
                    />
                    <Legend />
                    {providers.map(provider => (
                      <Bar
                        key={provider}
                        dataKey={provider}
                        name={provider}
                        fill={PROVIDER_COLORS[provider] || '#888888'}
                        stackId="a"
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-32 flex items-center justify-center text-gray-500 text-sm">
                Onvoldoende historische data beschikbaar om grafiek te tonen
              </div>
            )}
          </div>

          {/* Detailed Table */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
              <h3 className="font-semibold text-gray-900">Wekelijkse data per vervoerder</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase sticky left-0 bg-gray-50">
                      Week
                    </th>
                    {providers.map(provider => (
                      <th key={provider} className="px-3 py-3 text-center text-xs font-semibold text-gray-700 uppercase">
                        {provider}
                      </th>
                    ))}
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-900 uppercase bg-gray-100">
                      Totaal
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {[...snapshots].reverse().map((snapshot, idx, arr) => {
                    const prevSnapshot = arr[idx + 1];

                    return (
                      <tr key={snapshot.date} className="hover:bg-gray-50">
                        <td className="px-4 py-3 whitespace-nowrap font-medium text-gray-900 sticky left-0 bg-white">
                          {snapshot.week_label}
                        </td>
                        {providers.map(provider => {
                          const count = snapshot.totals.providers[provider] || 0;
                          const prevCount = prevSnapshot?.totals.providers[provider] || 0;
                          const diff = idx < arr.length - 1 ? count - prevCount : null;

                          return (
                            <td key={provider} className="px-3 py-3 text-center">
                              <span className="text-gray-900">{count.toLocaleString('nl-NL')}</span>
                              {diff !== null && diff !== 0 && (
                                <span className={`ml-1 text-xs ${diff > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                  ({diff > 0 ? '+' : ''}{diff})
                                </span>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-4 py-3 text-center font-semibold text-gray-900 bg-gray-50">
                          {snapshot.totals.total.toLocaleString('nl-NL')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 px-4 sm:px-6 py-3 sm:py-4 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            className="w-full px-4 py-3 sm:py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 active:bg-blue-800 transition font-medium text-base sm:text-sm"
          >
            Sluiten
          </button>
        </div>
      </div>
    </div>
  );
}
