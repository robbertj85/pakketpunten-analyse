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
  const isSchatting = pathname === '/data-export/schatting';

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
                  ? 'border-red-600 text-red-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
              }`}
            >
              <svg className="w-4 h-4 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M4.93 19h14.14c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.2 16c-.77 1.33.19 3 1.73 3z" />
              </svg>
              Pijnpunten
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
