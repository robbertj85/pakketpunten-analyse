'use client';

import { useState } from 'react';

interface VoorkeurStap {
  titel: string;
  opties: string[];
}

interface GemeenteBeleid {
  gemeente: string;
  voorkeur?: {
    titel: string;
    stappen: VoorkeurStap[];
    nb?: string;
  };
  principes: string[];
}

// Beleidsprincipes per gemeente voor het plaatsen van pakket- en brievenautomaten.
const BELEID: GemeenteBeleid[] = [
  {
    gemeente: 'Utrecht',
    voorkeur: {
      titel: 'Per wijk een viertrapsraket',
      stappen: [
        {
          titel: 'Volgorde van voorkeur voor gemeente (staande praktijk)',
          opties: ['Inpandig in bestaande winkels', 'Buiten op private grond'],
        },
        {
          titel:
            'Indien onvoldoende mogelijkheden hierboven testen we waar mogelijk in pilot vorm (nieuw voor Utrecht)',
          opties: ['Inpandig gemeentelijk vastgoed', 'Buiten op publieke grond'],
        },
      ],
      nb: 'Niet zeker dat plaatsing kluis in openbare ruimte noodzakelijk is en/of wordt geaccepteerd.',
    },
    principes: [
      'De pakket- en brievenautomaat wordt bij voorkeur op een centrale locatie die publiek toegankelijk is geplaatst.',
      'De pakket- en brievenautomaat heeft ‘rugdekking’ nodig.',
      'De automaat wordt niet als een losstaand object in de (openbare) ruimte geplaatst.',
      'Bij het plaatsen van de automaat wordt er bij voorkeur zo min mogelijk groen opgeofferd.',
      'De pakket- en brievenautomaten worden bij voorkeur bij zijgevels/de minste prominente gevel gepositioneerd.',
    ],
  },
];

export default function BeleidsprincipesPage() {
  const gemeenten = BELEID.map((b) => b.gemeente);
  const [selected, setSelected] = useState(gemeenten[0]);
  const beleid = BELEID.find((b) => b.gemeente === selected);

  return (
    <div className="space-y-6">
      <section data-tour="convenant" className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 bg-blue-50">
          <h2 className="font-semibold text-blue-900">
            Uitgangspunten Convenant Duurzame Stadslogistiek
          </h2>
        </div>
        <div className="px-6 py-5 space-y-3 text-sm text-gray-800 leading-relaxed">
          <p>
            Partijen werken samen aan het realiseren van een duurzaam, voor alle
            partijen toegankelijk en efficiënt netwerk van pakketpunten en
            pakketkluizen in steden. Hiermee beogen partijen:
          </p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
            {[
              'Verkeersdruk en -overlast door bezorging van pakketten te verminderen',
              'Duurzaamheid van deze logistieke keten te versterken, de leefbaarheid in de steden te vergroten',
              'Service naar ontvangers op peil te houden binnen de context van toenemende verstedelijking en autoluwe zones.',
              'Samen te werken aan de totstandkoming van PUDO-locaties bij (her)ontwikkeling van stedelijke gebieden, al dan niet met andere (publieke) functies.',
            ].map((doel, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex-shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-500" />
                <span>{doel}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <div data-tour="gemeente-select" className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Beleidsprincipes</h2>
          <p className="text-sm text-gray-600 mt-1 max-w-2xl">
            Uitgangspunten die gemeenten hanteren bij het plaatsen van pakket- en
            brievenautomaten in de openbare ruimte.
          </p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Gemeente
          </label>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {gemeenten.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
      </div>

      {beleid ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {beleid.voorkeur && (
            <div data-tour="voorkeur" className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 bg-blue-50">
                <h3 className="font-semibold text-blue-700">
                  {beleid.voorkeur.titel}
                </h3>
                <p className="text-sm text-blue-600">
                  Voorkeursvolgorde voor plaatsing per wijk
                </p>
              </div>
              <div className="px-6 py-5 space-y-5">
                {beleid.voorkeur.stappen.map((stap, si) => (
                  <div key={si}>
                    <p className="text-sm font-medium text-gray-900 mb-2">
                      {stap.titel}
                    </p>
                    <ol className="space-y-1.5">
                      {stap.opties.map((optie, oi) => (
                        <li key={oi} className="flex gap-3 text-sm text-gray-800">
                          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold flex items-center justify-center">
                            {oi + 1}
                          </span>
                          <span>{optie}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
                {beleid.voorkeur.nb && (
                  <p className="text-sm font-semibold text-gray-700 italic border-t border-gray-100 pt-4">
                    NB: {beleid.voorkeur.nb}
                  </p>
                )}
              </div>
            </div>
          )}

          <div data-tour="uitgangspunten" className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 bg-blue-50">
              <h3 className="font-semibold text-blue-900">
                Uitgangspunten voor plaatsing kluis buiten
              </h3>
              <p className="text-sm text-blue-700">
                {beleid.principes.length} beleidsprincipes — {beleid.gemeente}
              </p>
            </div>
            <ol className="divide-y divide-gray-100">
              {beleid.principes.map((principe, i) => (
                <li key={i} className="flex gap-4 px-6 py-4">
                  <span className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-100 text-blue-700 text-sm font-semibold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <p className="text-sm text-gray-800 leading-relaxed">{principe}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : (
        <div className="p-6 bg-amber-50 border border-amber-200 rounded-lg text-amber-900">
          Geen beleidsprincipes beschikbaar voor deze gemeente.
        </div>
      )}

      <p className="text-xs text-gray-500 italic">
        Aan de informatie op deze pagina kunnen geen rechten worden ontleend.
      </p>
    </div>
  );
}
