'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';

export default function DataExportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const isDownloads = pathname === '/data-export';
  const isMatrix = pathname === '/data-export/matrix';
  const isUpdates = pathname === '/data-export/updates';
  const isPainpoints = pathname === '/data-export/painpoints';
  const isGemeentePainpoints = pathname === '/data-export/gemeente-painpoints';
  const isSchatting = pathname === '/data-export/schatting';
  const isBereik = pathname === '/data-export/bereik';
  const isSuggesties = pathname === '/data-export/suggesties';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-[1600px] mx-auto px-4 py-4">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Pakketpunten - Data</h1>
              <p className="text-sm text-gray-600">
                Download pakketpunten data, bekijk statistieken en update status
              </p>
            </div>
            <Link
              href="/"
              className="px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-800"
            >
              ← Terug naar kaart
            </Link>
          </div>

          {/* Tab Navigation */}
          <nav className="flex gap-2 border-b border-gray-200">
            <Link
              href="/data-export"
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                isDownloads
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
              }`}
            >
              <svg className="w-4 h-4 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Downloads
            </Link>
            <Link
              href="/data-export/matrix"
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                isMatrix
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
              }`}
            >
              <svg className="w-4 h-4 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Data Matrix
            </Link>
            <Link
              href="/data-export/updates"
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                isUpdates
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
              }`}
            >
              <svg className="w-4 h-4 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Updates
            </Link>
            <Link
              href="/data-export/painpoints"
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                isPainpoints
                  ? 'border-blue-700 text-blue-700'
                  : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
              }`}
            >
              <svg className="w-4 h-4 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M4.93 19h14.14c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.2 16c-.77 1.33.19 3 1.73 3z" />
              </svg>
              Pijnpunten (carriers)
            </Link>
            <Link
              href="/data-export/gemeente-painpoints"
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                isGemeentePainpoints
                  ? 'border-blue-700 text-blue-700'
                  : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
              }`}
            >
              <svg className="w-4 h-4 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21h18M5 21V7l8-4 8 4v14M9 9h.01M9 12h.01M9 15h.01M9 18h.01M13 9h.01M13 12h.01M13 15h.01M13 18h.01" />
              </svg>
              Pijnpunten (gemeenten)
            </Link>
            <Link
              href="/data-export/schatting"
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                isSchatting
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
              }`}
            >
              <svg className="w-4 h-4 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3v18h18M7 14l4-4 3 3 5-5" />
              </svg>
              Schatting pakketpunten
            </Link>
            <Link
              href="/data-export/bereik"
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                isBereik
                  ? 'border-emerald-600 text-emerald-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
              }`}
            >
              <svg className="w-4 h-4 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.244-4.243a8 8 0 1111.314 0zM15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Bereik inwoners
            </Link>
            <Link
              href="/data-export/suggesties"
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                isSuggesties
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
              }`}
            >
              <svg className="w-4 h-4 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2v2m0 16v2m10-10h-2M4 12H2m15.07-7.07l-1.41 1.41M6.34 17.66l-1.41 1.41m12.14 0l-1.41-1.41M6.34 6.34L4.93 4.93M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              Plaatsingsadvies
            </Link>
          </nav>
        </div>
      </header>

      {/* Page Content */}
      <main className="max-w-[1600px] mx-auto px-4 py-8">
        {children}
      </main>
    </div>
  );
}
