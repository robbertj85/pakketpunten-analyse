'use client';

import { useState, useEffect } from 'react';

interface CarrierStats {
  successful_municipalities: number;
  failed_municipalities: number;
  total_points: number;
  latest_update: string | null;
  overall_success_rate: number;
}

interface UpdateStatus {
  last_update: string;
  total_municipalities: number;
  successful_municipalities: number;
  failed_municipalities: number;
  carrier_stats: {
    [key: string]: CarrierStats;
  };
  github_actions_url: string;
}

export default function UpdatesPage() {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/update-status')
      .then(res => res.json())
      .then(data => {
        setUpdateStatus(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch update status:', err);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Laden van update status...</div>
      </div>
    );
  }

  if (!updateStatus) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-red-900 mb-2">Update status niet beschikbaar</h2>
        <p className="text-sm text-red-700">
          Kon de update status niet ophalen. Probeer later opnieuw.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header section */}
      <section data-tour="status" className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-2">Update Status</h2>
        <p className="text-sm text-gray-600 mb-4">
          Data wordt wekelijks geüpdatet via geautomatiseerde GitHub Actions scripts.
        </p>

        {/* Last update timestamp */}
        <div className="flex items-center gap-2 mb-4">
          <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-sm font-medium text-gray-900">
            Laatste update:{' '}
            {new Date(updateStatus.last_update).toLocaleString('nl-NL', {
              day: '2-digit',
              month: 'long',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })}
          </span>
        </div>

        {/* Overall status summary */}
        <div data-tour="status-overzicht" className="bg-gray-50 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-gray-900">Overzicht</span>
            <span className={`text-xs px-2 py-1 rounded-full ${
              updateStatus.failed_municipalities === 0
                ? 'bg-green-100 text-green-800'
                : 'bg-orange-100 text-orange-800'
            }`}>
              {updateStatus.failed_municipalities === 0
                ? 'Alle gemeenten bijgewerkt'
                : `${updateStatus.failed_municipalities} gemeente(n) mislukt`}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold text-blue-600">{updateStatus.total_municipalities}</p>
              <p className="text-xs text-gray-600">Gemeenten</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-green-600">{updateStatus.successful_municipalities}</p>
              <p className="text-xs text-gray-600">Succesvol</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-orange-600">{updateStatus.failed_municipalities}</p>
              <p className="text-xs text-gray-600">Mislukt</p>
            </div>
          </div>
        </div>
      </section>

      {/* Carrier status list */}
      <section data-tour="per-vervoerder" className="bg-white rounded-lg shadow-md p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Status per vervoerder</h3>
        <div className="space-y-3">
          {Object.entries(updateStatus.carrier_stats).map(([carrier, stats]) => {
            const hasFailures = stats.failed_municipalities > 0;
            const successRate = Math.round((stats.successful_municipalities / updateStatus.total_municipalities) * 100);

            return (
              <div
                key={carrier}
                className={`p-4 rounded-lg border ${
                  hasFailures ? 'border-orange-200 bg-orange-50' : 'border-green-200 bg-green-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {/* Status icon */}
                    {hasFailures ? (
                      <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center">
                        <svg className="w-5 h-5 text-orange-600" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                      </div>
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                        <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}

                    {/* Carrier name and status */}
                    <div>
                      <h4 className={`font-semibold ${hasFailures ? 'text-orange-900' : 'text-green-900'}`}>
                        {carrier}
                      </h4>
                      <p className="text-sm text-gray-600">
                        {hasFailures ? (
                          <span>
                            {stats.successful_municipalities}/{updateStatus.total_municipalities} gemeenten bijgewerkt
                            <span className="text-orange-600 font-medium"> ({stats.failed_municipalities} mislukt)</span>
                          </span>
                        ) : (
                          <span>Alle {stats.successful_municipalities} gemeenten bijgewerkt</span>
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Points count */}
                  <div className="text-right">
                    <p className="text-lg font-bold text-gray-900">{stats.total_points.toLocaleString()}</p>
                    <p className="text-xs text-gray-500">punten</p>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                    <span>Dekking</span>
                    <span>{successRate}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all ${
                        hasFailures ? 'bg-orange-500' : 'bg-green-500'
                      }`}
                      style={{ width: `${successRate}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* GitHub Actions link */}
      <section data-tour="logs" className="bg-white rounded-lg shadow-md p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Volledige Logs</h3>
        <p className="text-sm text-gray-600 mb-4">
          Bekijk de volledige output van de laatste GitHub Actions workflow voor gedetailleerde informatie over eventuele fouten.
        </p>
        <a
          href={updateStatus.github_actions_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition font-medium text-sm"
        >
          <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 24 24">
            <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
          </svg>
          Bekijk GitHub Actions Logs
          <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      </section>
    </div>
  );
}
