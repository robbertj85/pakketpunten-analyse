'use client';

import { useEffect, useState } from 'react';

export default function TestPage() {
  const [status, setStatus] = useState<string>('Loading...');
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    console.log('Fetching amsterdam.geojson...');
    fetch('/data/amsterdam.geojson')
      .then(res => {
        console.log('Response status:', res.status);
        console.log('Response OK:', res.ok);
        console.log('Content-Type:', res.headers.get('content-type'));
        console.log('Content-Length:', res.headers.get('content-length'));

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        return res.json();
      })
      .then(data => {
        console.log('Data loaded successfully!');
        console.log('Metadata:', data.metadata);
        console.log('Features count:', data.features?.length);
        setData(data.metadata);
        setStatus('Success!');
      })
      .catch(err => {
        console.error('Error:', err);
        console.error('Error name:', err.name);
        console.error('Error message:', err.message);
        setStatus(`Error: ${err.message}`);
      });
  }, []);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Amsterdam GeoJSON Test</h1>
      <p className="mb-2">Status: {status}</p>
      {data && (
        <pre className="bg-secondary p-4 rounded overflow-auto max-h-96">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}
