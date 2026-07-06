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
  Bar
} from 'recharts';

interface ProviderHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  providerName: string;
  snapshots: HistorySnapshot[];
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

export default function ProviderHistoryModal({
  isOpen,
  onClose,
  providerName,
  snapshots
}: ProviderHistoryModalProps) {
  if (!isOpen) return null;

  // Prepare chart data from snapshots
  const chartData = snapshots.map(snapshot => ({
    week: snapshot.week_label,
    date: snapshot.date,
    count: snapshot.totals.providers[providerName] || 0,
    total: snapshot.totals.total
  }));

  // Calculate statistics
  const firstEntry = chartData[0];
  const lastEntry = chartData[chartData.length - 1];
  const totalChange = lastEntry ? lastEntry.count - (firstEntry?.count || 0) : 0;
  // null = geen baseline (vervoerder was er nog niet in de eerste snapshot)
  const percentageChange = firstEntry?.count > 0
    ? ((totalChange / firstEntry.count) * 100).toFixed(1)
    : null;

  // Calculate weekly changes for bar chart
  const weeklyChanges = chartData.map((entry, idx) => {
    const prevEntry = chartData[idx - 1];
    return {
      week: entry.week,
      change: prevEntry ? entry.count - prevEntry.count : 0
    };
  }).slice(1); // Remove first entry (no previous to compare)

  // Calculate market share over time
  const marketShareData = chartData.map(entry => ({
    week: entry.week,
    share: entry.total > 0 ? ((entry.count / entry.total) * 100).toFixed(1) : 0
  }));

  const providerColor = PROVIDER_COLORS[providerName] || '#888888';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-t-xl sm:rounded-lg shadow-xl w-full sm:max-w-6xl max-h-[85vh] sm:max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 flex justify-between items-center">
          <div className="flex items-center gap-3">
            {PROVIDER_LOGOS[providerName] ? (
              <img
                src={PROVIDER_LOGOS[providerName]}
                alt={providerName}
                className="w-10 h-10 object-contain"
              />
            ) : (
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: providerColor }}
              >
                <span className="text-white font-bold text-sm">
                  {providerName.substring(0, 2)}
                </span>
              </div>
            )}
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-gray-900">{providerName}</h2>
              <p className="text-xs sm:text-sm text-gray-600">Historische ontwikkeling pakketpunten</p>
            </div>
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
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 sm:space-y-6">
          {/* Summary stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            <div className="bg-blue-50 rounded-lg p-3 sm:p-4">
              <div className="text-xl sm:text-2xl font-bold text-blue-900">
                {lastEntry?.count.toLocaleString('nl-NL') || 0}
              </div>
              <div className="text-xs sm:text-sm text-blue-700">Huidige stand</div>
            </div>
            <div className={`rounded-lg p-3 sm:p-4 ${totalChange >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
              <div className={`text-xl sm:text-2xl font-bold ${totalChange >= 0 ? 'text-green-900' : 'text-red-900'}`}>
                {totalChange >= 0 ? '+' : ''}{totalChange.toLocaleString('nl-NL')}
              </div>
              <div className={`text-xs sm:text-sm ${totalChange >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                Sinds {firstEntry?.week}
              </div>
            </div>
            <div className={`rounded-lg p-3 sm:p-4 ${percentageChange == null ? 'bg-gray-50' : Number(percentageChange) >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
              <div className={`text-xl sm:text-2xl font-bold ${percentageChange == null ? 'text-gray-900' : Number(percentageChange) >= 0 ? 'text-green-900' : 'text-red-900'}`}>
                {percentageChange == null
                  ? (lastEntry?.count > 0 ? 'nieuw' : '—')
                  : `${Number(percentageChange) >= 0 ? '+' : ''}${percentageChange}%`}
              </div>
              <div className={`text-xs sm:text-sm ${percentageChange == null ? 'text-gray-700' : Number(percentageChange) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                Groei percentage
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 sm:p-4">
              <div className="text-xl sm:text-2xl font-bold text-gray-900">
                {marketShareData[marketShareData.length - 1]?.share || 0}%
              </div>
              <div className="text-xs sm:text-sm text-gray-700">Marktaandeel</div>
            </div>
          </div>

          {/* Main Line Chart */}
          <div className="bg-white border border-gray-200 rounded-lg p-3 sm:p-4">
            <h3 className="font-semibold text-gray-900 mb-3 sm:mb-4 text-sm sm:text-base">
              Aantal pakketpunten over tijd
            </h3>
            <div className="h-48 sm:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis
                    dataKey="week"
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value) => value.split('-')[1]}
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
                    formatter={(value: number) => [value.toLocaleString('nl-NL'), providerName]}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="count"
                    name={providerName}
                    stroke={providerColor}
                    strokeWidth={2}
                    dot={{ fill: providerColor, strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Weekly Changes Bar Chart */}
          {weeklyChanges.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-3 sm:p-4">
              <h3 className="font-semibold text-gray-900 mb-3 sm:mb-4 text-sm sm:text-base">
                Wekelijkse verandering
              </h3>
              <div className="h-40 sm:h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeklyChanges} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      dataKey="week"
                      tick={{ fontSize: 12 }}
                      tickFormatter={(value) => value.split('-')[1]}
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
                      formatter={(value: number) => [
                        `${value >= 0 ? '+' : ''}${value}`,
                        'Verandering'
                      ]}
                    />
                    <Bar
                      dataKey="change"
                      fill={providerColor}
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* History table */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
              <h3 className="font-semibold text-gray-900">Wekelijkse data</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Week</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Periode</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-900 uppercase bg-gray-100">
                      Pakketpunten
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 uppercase">Verschil</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 uppercase">Marktaandeel</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {[...snapshots].reverse().map((snapshot, idx, arr) => {
                    const count = snapshot.totals.providers[providerName] || 0;
                    const prevSnapshot = arr[idx + 1];
                    const prevCount = prevSnapshot?.totals.providers[providerName] || 0;
                    const diff = idx < arr.length - 1 ? count - prevCount : 0;
                    const share = snapshot.totals.total > 0
                      ? ((count / snapshot.totals.total) * 100).toFixed(1)
                      : '0';

                    return (
                      <tr key={snapshot.date} className="hover:bg-gray-50">
                        <td className="px-4 py-3 whitespace-nowrap font-medium text-gray-900">
                          {snapshot.week_label}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-600 text-xs">
                          {formatDateRange(snapshot.date_from, snapshot.date_to)}
                        </td>
                        <td className="px-4 py-3 text-center font-semibold text-gray-900 bg-gray-50">
                          {count.toLocaleString('nl-NL')}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {idx < arr.length - 1 ? (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                              diff > 0 ? 'bg-green-50 text-green-700' :
                              diff < 0 ? 'bg-red-50 text-red-700' :
                              'bg-gray-50 text-gray-500'
                            }`}>
                              {diff > 0 ? '+' : ''}{diff}
                            </span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center text-gray-600">
                          {share}%
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
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-gray-200 bg-gray-50">
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

function formatDateRange(from: string, to: string): string {
  const fromDate = new Date(from);
  const toDate = new Date(to);

  const fromDay = fromDate.getDate();
  const toDay = toDate.getDate();
  const fromMonth = fromDate.toLocaleString('nl-NL', { month: 'short' });
  const toMonth = toDate.toLocaleString('nl-NL', { month: 'short' });

  if (fromMonth === toMonth) {
    return `${fromDay} - ${toDay} ${fromMonth}`;
  }
  return `${fromDay} ${fromMonth} - ${toDay} ${toMonth}`;
}
