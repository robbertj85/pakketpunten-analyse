'use client';

import { useState, useEffect, useRef } from 'react';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AboutModal({ isOpen, onClose }: AboutModalProps) {
  const [activeTab, setActiveTab] = useState<'about' | 'sources' | 'usage' | 'links'>('about');
  const contentRef = useRef<HTMLDivElement>(null);

  // Reset scroll position when tab changes
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, [activeTab]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-t-xl sm:rounded-lg shadow-xl w-full sm:max-w-3xl max-h-[70vh] sm:max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 flex justify-between items-center bg-white flex-shrink-0">
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Over dit project</h2>
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

        {/* Tabs - scrollable on mobile */}
        <div className="flex border-b border-gray-200 px-2 sm:px-6 overflow-x-auto scrollbar-hide bg-white flex-shrink-0">
          <button
            onClick={() => setActiveTab('about')}
            className={`py-3 px-3 sm:px-4 font-medium text-xs sm:text-sm border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'about'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Over
          </button>
          <button
            onClick={() => setActiveTab('sources')}
            className={`py-3 px-3 sm:px-4 font-medium text-xs sm:text-sm border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'sources'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Bronnen
          </button>
          <button
            onClick={() => setActiveTab('usage')}
            className={`py-3 px-3 sm:px-4 font-medium text-xs sm:text-sm border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'usage'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Gebruik
          </button>
          <button
            onClick={() => setActiveTab('links')}
            className={`py-3 px-3 sm:px-4 font-medium text-xs sm:text-sm border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'links'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Links
          </button>
        </div>

        {/* Content */}
        <div ref={contentRef} className="flex-1 overflow-y-auto px-4 sm:px-6 py-3 sm:py-4">
          {activeTab === 'about' && (
            <div className="space-y-4">
              <section>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Pakketpunten Nederland</h3>
                <p className="text-gray-700 text-sm leading-relaxed mb-3">
                  Een interactief visualisatieplatform voor pakketpuntlocaties in Nederland.
                  Dit project verzamelt publieke data van meerdere vervoerders en toont deze
                  op een overzichtelijke kaart met filteropties en statistieken.
                </p>
                <p className="text-gray-700 text-sm leading-relaxed">
                  De Pakketpuntenviewer ondersteunt gemeenten, onderzoekers en beleidsmakers bij het analyseren van de dekkingsgraad van pakketpunten over de gemeenten en het identificeren van onderbedeelde gebieden om nieuwe plaatsingen van pakketpunten mogelijk te maken.
                </p>
              </section>

              <section>
                <h4 className="text-md font-semibold text-gray-900 mb-2">Features</h4>
                <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                  <li>Interactieve kaart met alle Nederlandse gemeenten</li>
                  <li>Real-time filtering op vervoerder en locatie</li>
                  <li>Dekkingsgebied visualisatie (300m en 400m buffers)</li>
                  <li>Statistieken per gemeente en vervoerder</li>
                  <li>Responsive design voor desktop en mobiel</li>
                  <li>Export functionaliteit voor data-analyse</li>
                </ul>
              </section>

              <section>
                <h4 className="text-md font-semibold text-gray-900 mb-2">Dankbetuiging</h4>
                <p className="text-sm text-gray-700 leading-relaxed">
                  Dit prototype is gebaseerd op een concept van en in samenwerking met de{' '}
                  <strong>Gemeente Zwolle</strong>, waarvoor dank!
                </p>
              </section>

              <section>
                <h4 className="text-md font-semibold text-gray-900 mb-2">Open Source</h4>
                <p className="text-sm text-gray-700 leading-relaxed mb-2">
                  Dit project is open source en beschikbaar onder de MIT-licentie.
                  Voor technische documentatie, broncode en contributie mogelijkheden:
                </p>
                <a
                  href="https://github.com/Ida-BirdsEye/pakketpunten"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center text-sm text-blue-600 hover:text-blue-800 font-medium"
                >
                  <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 24 24">
                    <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                  </svg>
                  GitHub Repository
                </a>
              </section>
            </div>
          )}

          {activeTab === 'sources' && (
            <div className="space-y-4">
              <section>
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Data Bronnen</h3>
                <p className="text-sm text-gray-700 mb-4">
                  Locatiegegevens worden verzameld van publieke API's en websites van de
                  betreffende vervoerders zonder authenticatie vereisten.
                </p>
              </section>

              <div className="space-y-3">
                <DataSourceCard
                  name="DHL Parcel Netherlands"
                  endpoint="api-gw.dhlparcel.nl/parcel-shop-locations"
                  type="Public REST API"
                  url="https://www.dhl.nl"
                  color="#FFCC00"
                />

                <DataSourceCard
                  name="PostNL"
                  endpoint="productprijslokatie.postnl.nl/location-widget"
                  type="Public REST API"
                  url="https://www.postnl.nl"
                  color="#FF6600"
                />

                <DataSourceCard
                  name="DPD Netherlands"
                  endpoint="pickup.dpd.cz/api/GetParcelShopsByAddress"
                  type="Public REST API"
                  url="https://www.dpd.com/nl"
                  color="#DC0032"
                />

                <DataSourceCard
                  name="VintedGo / Mondial Relay"
                  endpoint="vintedgo.com/nl/carrier-locations"
                  type="Web Scraping"
                  url="https://vintedgo.com"
                  color="#09B1BA"
                />

                <DataSourceCard
                  name="De Buren"
                  endpoint="mijnburen.deburen.nl/maps"
                  type="Web Scraping"
                  url="https://deburen.nl"
                  color="#4CAF50"
                />

                <DataSourceCard
                  name="Amazon Hub (Lockers & Counters)"
                  endpoint="amazon.nl/ulp"
                  type="Browser Automation"
                  url="https://www.amazon.nl/ulp"
                  color="#FF9900"
                />

                <DataSourceCard
                  name="GLS ParcelShop"
                  endpoint="apm.gls.nl/glspoints/nearby"
                  type="Browser Automation"
                  url="https://www.gls-info.nl/parcel-shop"
                  color="#003C7E"
                />

                <DataSourceCard
                  name="ViaTim"
                  endpoint="production.viapunt-api.viatim.nl/public/servicepoints"
                  type="Public REST API"
                  url="https://viatim.nl"
                  color="#E3007A"
                />

                <DataSourceCard
                  name="InPost / Mondial Relay"
                  endpoint="api-global-points.easypack24.net/v1/points"
                  type="Public REST API"
                  url="https://inpost.nl"
                  color="#FFCD00"
                />

                <DataSourceCard
                  name="Budbee / Instabee"
                  endpoint="DPD cache + OpenStreetMap"
                  type="Cache + OSM"
                  url="https://budbee.com"
                  color="#00C389"
                />
              </div>

              <section className="border-t pt-4 mt-4">
                <h4 className="text-md font-semibold text-gray-900 mb-2">Aanvullende Bronnen</h4>
                <ul className="text-sm text-gray-700 space-y-2">
                  <li>
                    <strong>Adreszoeken:</strong> PDOK Locatieserver
                    <span className="text-gray-500 ml-2">Publieke Dienstverlening Op de Kaart</span>
                  </li>
                  <li>
                    <strong>Gemeentegrenzen:</strong> OpenStreetMap / Nominatim
                    <span className="text-gray-500 ml-2">© OpenStreetMap contributors</span>
                  </li>
                  <li>
                    <strong>Kaartachtergrond:</strong> OpenStreetMap tiles
                    <span className="text-gray-500 ml-2">© OpenStreetMap contributors</span>
                  </li>
                </ul>
              </section>

              <section className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-blue-900 mb-2">Update Frequentie</h4>
                <p className="text-sm text-blue-800 mb-3">
                  Data wordt wekelijks geüpdatet via geautomatiseerde scripts.
                </p>
                <a
                  href="/data-export"
                  className="inline-flex items-center text-sm text-blue-700 hover:text-blue-900 font-medium"
                >
                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  Bekijk gedetailleerde update status op de Data pagina
                </a>
              </section>
            </div>
          )}

          {activeTab === 'usage' && (
            <div className="space-y-4">
              <section>
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Gebruiksvoorwaarden</h3>
                <p className="text-sm text-gray-700 mb-3">
                  Dit project is bedoeld voor onderzoek, educatie en niet-commercieel gebruik.
                  Respecteer de individuele gebruiksvoorwaarden van de API providers.
                </p>
              </section>

              <section>
                <h4 className="text-md font-semibold text-gray-900 mb-3">API Provider Policies</h4>
                <div className="space-y-2 text-sm text-gray-700">
                  <p><strong>DHL, PostNL, DPD, GLS, ViaTim, InPost:</strong> Publieke API's voor consumentengebruik. Respecteer rate limits en gebruiksvoorwaarden.</p>
                  <p><strong>VintedGo, De Buren:</strong> Data verzameld via publiek toegankelijke websites. Niet geschikt voor high-frequency scraping.</p>
                  <p><strong>Amazon Hub:</strong> Data verzameld via browser automatisering. Gecached en wekelijks bijgewerkt.</p>
                  <p><strong>Budbee:</strong> Data samengesteld uit DPD dataset en OpenStreetMap. Gecached en wekelijks bijgewerkt.</p>
                  <p><strong>Algemeen:</strong> Geen geautomatiseerde hoge-frequentie verzoeken. Gebruik cached data waar mogelijk.</p>
                </div>
              </section>

              <section className="border-t pt-4 mt-4">
                <h4 className="text-md font-semibold text-gray-900 mb-2">Vereiste Attributie</h4>
                <p className="text-sm text-gray-700 mb-3">
                  Bij gebruik of redistributie van dit project:
                </p>
                <div className="bg-gray-50 border border-gray-200 rounded p-3 text-xs font-mono">
                  <pre className="whitespace-pre-wrap text-gray-800">
{`Data bronnen:
- DHL Parcel Netherlands (https://www.dhl.nl)
- PostNL (https://www.postnl.nl)
- DPD Netherlands (https://www.dpd.com/nl)
- VintedGo / Mondial Relay (https://vintedgo.com)
- De Buren (https://deburen.nl)
- Amazon Hub Lockers & Counters (https://www.amazon.nl/ulp)
- GLS ParcelShop (https://www.gls-info.nl)
- ViaTim (https://viatim.nl)
- InPost / Mondial Relay (https://inpost.nl)
- Budbee / Instabee (https://budbee.com)
- Gemeente grenzen © OpenStreetMap contributors
- Verkeersongevallen (BRON 2022-2024) © Rijkswaterstaat (publiek domein) — geo.rijkswaterstaat.nl

Bezettingsgraad data is willekeurig gegenereerd voor demonstratie (niet echt)

Project: Pakketpunten Nederland
Repository: github.com/Ida-BirdsEye/pakketpunten
License: MIT`}
                  </pre>
                </div>
              </section>

              <section className="bg-gray-50 border border-gray-300 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-gray-900 mb-2">Disclaimer</h4>
                <p className="text-xs text-gray-700 leading-relaxed">
                  Dit project wordt geleverd "as is" zonder garantie. Data is verzameld van publieke
                  bronnen en kan onnauwkeurigheden bevatten. Verifieer locatiegegevens bij de vervoerders.
                  Dit project is niet gelieerd aan de databronbedrijven.
                </p>
              </section>

              <section className="border-t pt-4 mt-4">
                <h4 className="text-md font-semibold text-gray-900 mb-2">Meer Informatie</h4>
                <p className="text-sm text-gray-700 mb-2">
                  Voor technische documentatie en uitgebreide details:
                </p>
                <a
                  href="https://github.com/Ida-BirdsEye/pakketpunten"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center text-sm text-blue-600 hover:text-blue-800 font-medium"
                >
                  <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 24 24">
                    <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                  </svg>
                  GitHub Repository
                </a>
              </section>
            </div>
          )}

          {activeTab === 'links' && (
            <div className="space-y-4">
              <section>
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Externe Bronnen</h3>
                <p className="text-sm text-gray-700 mb-4">
                  Relevante externe bronnen en rapporten over pakketlogistiek in Nederland.
                </p>
              </section>

              <div className="space-y-3">
                <div className="border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition">
                  <h4 className="font-semibold text-gray-900 mb-2">Inzichten en Effecten Pakketkluizen</h4>
                  <p className="text-sm text-gray-700 mb-3">
                    Onderzoek door Topsector Logistiek naar de inzet van pakketkluizen en alternatieve
                    aflevermethoden voor gemeenten. Focus op duurzame stedelijke logistiek en leefbare openbare ruimtes.
                  </p>
                  <div className="flex gap-3">
                    <a
                      href="https://topsectorlogistiek.nl/wp-content/uploads/2025/02/250205_Eindrapportage.pdf"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center text-sm text-blue-600 hover:text-blue-800 font-medium"
                    >
                      <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      PDF Rapport
                    </a>
                    <a
                      href="https://topsectorlogistiek.nl/kennisbank/inzichten-en-effecten-pakketkluizen/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center text-sm text-blue-600 hover:text-blue-800 font-medium"
                    >
                      <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      Projectpagina
                    </a>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">Publicatie: 10 februari 2025 | Topsector Logistiek</p>
                </div>

                <div className="border border-gray-200 rounded-lg p-4 hover:border-orange-300 transition">
                  <h4 className="font-semibold text-gray-900 mb-2">ACM Post- en Pakketmonitor</h4>
                  <p className="text-sm text-gray-700 mb-3">
                    Interactieve dashboard van de Autoriteit Consument & Markt met officiële statistieken
                    over de Nederlandse post- en pakketmarkt, inclusief markttrends en kwaliteitsindicatoren.
                  </p>
                  <a
                    href="https://public.tableau.com/views/Post-enpakketmonitor/OVER"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center text-sm text-orange-600 hover:text-orange-800 font-medium"
                  >
                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                    Dashboard Openen
                  </a>
                  <p className="text-xs text-gray-500 mt-2">Autoriteit Consument & Markt (ACM)</p>
                </div>

                <div className="border border-gray-200 rounded-lg p-4 hover:border-green-300 transition">
                  <h4 className="font-semibold text-gray-900 mb-2">A Greener Last Mile: Carbon Emission Impact of Pickup Points</h4>
                  <p className="text-sm text-gray-700 mb-3">
                    Wetenschappelijke studie over de CO₂-impact van afhaalpunten in last-mile pakketbezorging.
                    Analyseert hoe pakketpunten en pakketkluizen bijdragen aan duurzamere stadslogistiek
                    vergeleken met traditionele thuisbezorging.
                  </p>
                  <a
                    href="https://www.sciencedirect.com/science/article/pii/S1364032123004872"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center text-sm text-green-600 hover:text-green-800 font-medium"
                  >
                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                    Lees Artikel (ScienceDirect)
                  </a>
                  <p className="text-xs text-gray-500 mt-2">Renewable and Sustainable Energy Reviews | Augustus 2023</p>
                </div>

                <div className="border border-gray-200 rounded-lg p-4 hover:border-purple-300 transition">
                  <h4 className="font-semibold text-gray-900 mb-2">Drivers of Consumers' Adoption of Parcel Lockers</h4>
                  <p className="text-sm text-gray-700 mb-3">
                    Studie naar consumentenadoptie van pakketkluizen in opkomende economieën (case study: Medellín, Colombia).
                    Belangrijkste bevindingen: gemak en leversnelheid zijn de sterkste drivers; innovatieve en milieubewuste
                    consumenten adopteren sneller. Opvallend: hoewel respondenten zichzelf als milieubewust beschouwen,
                    zien ze geen sterke link tussen pakketkluizen en milieuvoordelen — dit wijst op een kenniskloof.
                  </p>
                  <a
                    href="https://www.sciencedirect.com/science/article/pii/S259019822600031X"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center text-sm text-purple-600 hover:text-purple-800 font-medium"
                  >
                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                    Lees Artikel (Open Access)
                  </a>
                  <p className="text-xs text-gray-500 mt-2">Transportation Research Interdisciplinary Perspectives | Januari 2026</p>
                </div>
              </div>
            </div>
          )}
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

// Helper component for data source cards
function DataSourceCard({
  name,
  endpoint,
  type,
  url,
  color
}: {
  name: string;
  endpoint: string;
  type: string;
  url: string;
  color: string;
}) {
  return (
    <div className="border border-gray-200 rounded-lg p-3 hover:border-gray-300 transition">
      <div className="flex items-start">
        <div
          className="w-4 h-4 rounded-full mt-0.5 mr-3 flex-shrink-0"
          style={{ backgroundColor: color }}
        />
        <div className="flex-1 min-w-0">
          <h5 className="font-semibold text-sm text-gray-900">{name}</h5>
          <p className="text-xs text-gray-600 mt-1">
            <span className="font-medium">Type:</span> {type}
          </p>
          <p className="text-xs text-gray-500 mt-0.5 font-mono break-all">
            {endpoint}
          </p>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:text-blue-800 mt-1 inline-block"
          >
            {url} ↗
          </a>
        </div>
      </div>
    </div>
  );
}

// Helper component for usage items
function UsageItem({ allowed, children }: { allowed: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-start text-sm">
      <span className={`mr-2 mt-0.5 ${allowed ? 'text-green-600' : 'text-red-600'}`}>
        {allowed ? '✓' : '✗'}
      </span>
      <span className={allowed ? 'text-gray-700' : 'text-gray-600'}>{children}</span>
    </div>
  );
}
