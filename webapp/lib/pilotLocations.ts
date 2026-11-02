// Kandidaat-pilotlocaties per gemeente voor het plaatsen van een pakketkluis.
//
// Dit is een curated werklijst die voortkomt uit de gesprekken met gemeenten —
// géén uitkomst van het rekenmodel (dat staat onder /data-export/suggesties en
// /data-export/netwerkplanner). Coordinaten zijn per locatie herleidbaar via
// het veld `coordBron`, zodat duidelijk blijft wat is aangeleverd en wat is
// nagezocht. Attentiepunten (`letOp`) markeren wat nog geverifieerd moet
// worden voordat een locatie in een pilot-aanvraag terechtkomt.

export type PilotStatus =
  | 'pilot'
  | 'draagvlak'
  | 'in-gesprek'
  | 'nog-niet-gesproken'
  | 'uitwerken';

export type PilotType =
  | 'pr'
  | 'openbare-ruimte'
  | 'leegstand'
  | 'fietsparkeren'
  | 'ov-station'
  | 'sportlocatie'
  | 'onbepaald';

export type CoordBron = 'aangeleverd' | 'pdok-bag' | 'osm' | 'kaartpin';

export interface PilotLocation {
  id: string;
  /** Weergavenaam van de gemeente. */
  gemeente: string;
  /** Slug van de gemeente — koppelt aan /data/{slug}.geojson en de 3D-viewer. */
  slug: string;
  naam: string;
  adres?: string;
  lat: number;
  lon: number;
  type: PilotType;
  status: PilotStatus;
  /** Volgorde waarin de gemeente de locaties noemde (1 = eerste locatie). */
  rang: number;
  /** Korte onderbouwing — een alinea per punt. */
  toelichting: string[];
  /** Concrete vervolgstap voor deze locatie. */
  vervolg?: string;
  /** Datakwaliteit: wat moet nog geverifieerd worden. */
  letOp?: string;
  coordBron: CoordBron;
  /** Externe verwijzing (bijv. de gedeelde kaartpin). */
  bron?: { label: string; url: string };
}

export const STATUS_META: Record<
  PilotStatus,
  { label: string; badge: string; dot: string; uitleg: string }
> = {
  pilot: {
    label: 'Huidige pilot',
    badge: 'bg-violet-50 text-violet-800 border-violet-200',
    dot: '#7c3aed',
    uitleg: 'Geldt als huidige pilotlocatie van de gemeente; ontwerp, maatvoering of vergunningen in uitwerking.',
  },
  draagvlak: {
    label: 'Draagvlak',
    badge: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    dot: '#059669',
    uitleg: 'Gemeente staat positief tegenover deze locatie.',
  },
  'in-gesprek': {
    label: 'In gesprek',
    badge: 'bg-blue-50 text-blue-800 border-blue-200',
    dot: '#2563eb',
    uitleg: 'Locatie is onderwerp van gesprek, besluit nog niet genomen.',
  },
  uitwerken: {
    label: 'Uitwerken',
    badge: 'bg-amber-50 text-amber-800 border-amber-200',
    dot: '#d97706',
    uitleg: 'Gewenste locatie die ruimtelijk verder uitgewerkt moet worden.',
  },
  'nog-niet-gesproken': {
    label: 'Nog niet gesproken',
    badge: 'bg-gray-100 text-gray-700 border-gray-300',
    dot: '#6b7280',
    uitleg: 'Nog geen gesprek gevoerd met de eigenaar of beheerder.',
  },
};

export const TYPE_META: Record<PilotType, { label: string; uitleg: string }> = {
  pr: {
    label: 'P+R / transferium',
    uitleg:
      'Parkeerterrein aan de rand van de stad — ruimte beschikbaar, maar weinig inwoners binnen loopafstand.',
  },
  'openbare-ruimte': {
    label: 'Openbare ruimte',
    uitleg:
      'Plaatsing op publieke grond. Raakt direct aan de beleidsprincipes over rugdekking, groen en gevelpositie.',
  },
  leegstand: {
    label: 'Leegstaand vastgoed',
    uitleg:
      'Inpandige plaatsing in een leegstaand pand — hoogste trede in de voorkeursvolgorde van de gemeente.',
  },
  fietsparkeren: {
    label: 'Fietsenstalling',
    uitleg:
      'Bestaande (bewaakte) fietsenstalling: inpandig, sociale controle aanwezig, rugdekking geregeld.',
  },
  'ov-station': {
    label: 'OV-station',
    uitleg:
      'Plaatsing bij of in een metro- of OV-station: veel passanten en sociale controle, ophalen past in een bestaande reisbeweging.',
  },
  sportlocatie: {
    label: 'Sportlocatie',
    uitleg:
      'Plaatsing bij een sportcomplex: eigen terrein met parkeerruimte en vaste bezoekersstromen, buiten de woonstraat.',
  },
  onbepaald: {
    label: 'Vorm nog te bepalen',
    uitleg: 'Inrichtingsvorm van deze locatie is nog niet vastgesteld.',
  },
};

export const PILOT_LOCATIONS: PilotLocation[] = [
  // ---------------------------------------------------------------- Amsterdam
  {
    id: 'amsterdam-waterlooplein',
    gemeente: 'Amsterdam',
    slug: 'amsterdam',
    naam: 'Metrostation Waterlooplein',
    lat: 52.3673943,
    lon: 4.9022371,
    type: 'ov-station',
    status: 'pilot',
    rang: 1,
    coordBron: 'osm',
    toelichting: [
      'Concrete pilot voor Amsterdam. Ontwerp, renders en maatvoering zijn al ver uitgewerkt.',
      'Metrostation in de binnenstad: veel passanten en sociale controle, en ophalen past in een bestaande reisbeweging.',
    ],
    vervolg: 'Uitgewerkt ontwerp toetsen aan de beleidsprincipes en de plaatsing vastleggen.',
    letOp:
      'Coordinaat is het stationsobject in OpenStreetMap, niet de exacte kluispositie uit het ontwerp.',
  },

  // ---------------------------------------------------------------- Rotterdam
  {
    id: 'rotterdam-romeynshof',
    gemeente: 'Rotterdam',
    slug: 'rotterdam',
    naam: 'Romeynshof, Ommoord',
    lat: 51.9615094,
    lon: 4.5428712,
    type: 'ov-station',
    status: 'pilot',
    rang: 1,
    coordBron: 'osm',
    toelichting: [
      'Concrete pilot voor Rotterdam. Er is circa 10 m beschikbaar voor de kluis.',
      'Ligt in Ommoord bij het eindpunt van metrolijn B, midden in een dichtbewoonde hoogbouwwijk.',
    ],
    vervolg: 'Ruimtelijke en gemeentelijke uitwerking van de plek afronden.',
    letOp:
      'Coordinaat is metrostation Romeynshof (OpenStreetMap); de exacte plek met de beschikbare 10 m nog vastleggen.',
  },

  // ---------------------------------------------------------------- Den Haag
  {
    id: 'den-haag-conradkade',
    gemeente: 'Den Haag',
    slug: 'den-haag',
    naam: 'Conradkade',
    lat: 52.080590683410726,
    lon: 4.284260552623422,
    type: 'onbepaald',
    status: 'in-gesprek',
    rang: 1,
    coordBron: 'aangeleverd',
    toelichting: [
      'Eerste pilotlocatie voor Den Haag. Het coordinaat is rechtstreeks aangeleverd; de exacte plek op de kade is daarmee vastgelegd.',
      'Ligt in de dichtbebouwde vooroorlogse stadsdelen ten westen van het centrum, waar de meeste woningen geen ruimte hebben voor bezorging aan de deur.',
    ],
    vervolg:
      'Adres, eigendomssituatie en inrichtingsvorm (inpandig of buitenruimte) vastleggen.',
    letOp:
      'Geen adres of pandgegevens bekend — alleen een coordinaat. Type plaatsing daarom nog niet te bepalen.',
  },
  {
    id: 'den-haag-nobelstraat',
    gemeente: 'Den Haag',
    slug: 'den-haag',
    naam: 'Nobelstraat 2D — Biesieklette-stalling',
    adres: 'Nobelstraat 2D, 2513 BB Den Haag',
    lat: 52.07863291,
    lon: 4.30706424,
    type: 'fietsparkeren',
    status: 'pilot',
    rang: 2,
    coordBron: 'pdok-bag',
    toelichting: [
      'Tweede pilotlocatie voor Den Haag: een bestaande Biesieklette-fietsenstalling in het centrum, dus inpandig en met toezicht.',
      'Inpandige plaatsing in bestaand (gemeentelijk) vastgoed staat hoog in de voorkeursvolgorde van gemeenten en omzeilt de discussie over objecten in de openbare ruimte.',
      'Staat samen met een pop-up-variant op de huidige shortlist van Den Haag. Detaillering en vergunningen zijn nog nodig.',
    ],
    vervolg:
      'Detaillering en vergunningen uitwerken; openingstijden van de stalling toetsen tegen de gewenste 24/7-beschikbaarheid van een kluis.',
    letOp:
      'BAG-geocodering geeft voor Nobelstraat 2D postcode 2513 BD, niet 2513 BB — postcode verifieren.',
  },

  // ------------------------------------------------------------------ Utrecht
  {
    id: 'utrecht-griftpark',
    gemeente: 'Utrecht',
    slug: 'utrecht',
    naam: 'Griftpark',
    lat: 52.099177,
    lon: 5.127841,
    type: 'openbare-ruimte',
    status: 'uitwerken',
    rang: 1,
    coordBron: 'aangeleverd',
    toelichting: [
      'Aangedragen als pijnpunt door drie carriers — de vraag is hier dus aantoonbaar, en niet vanuit een enkele partij.',
      'Ligt echter sterk in de openbare ruimte; mogelijk te veel voor wat de gemeente ruimtelijk acceptabel vindt.',
      'Wel een gewenste locatie om verder uit te werken, samen met een landschapsarchitect, om te toetsen wat we ruimtelijk wenselijk achten.',
    ],
    vervolg:
      'Ontwerpsessie met landschapsarchitect: inpassing toetsen aan de beleidsprincipes (rugdekking, geen losstaand object, zo min mogelijk groen opofferen).',
  },
  {
    id: 'utrecht-vaartsche-rijn',
    gemeente: 'Utrecht',
    slug: 'utrecht',
    naam: 'Winkel Vaartsche Rijn',
    lat: 52.0789532,
    lon: 5.1221756,
    type: 'leegstand',
    status: 'pilot',
    rang: 2,
    coordBron: 'kaartpin',
    toelichting: [
      'Leegstaand pand bij Vaartsche Rijn. Inpandige plaatsing in bestaand vastgoed is de eerste trede in de voorkeursvolgorde van Utrecht — geen object in de openbare ruimte.',
      'Ligging aan de zuidkant van de binnenstad, binnen loopafstand van een dichtbewoond gebied.',
      'Een van de drie concrete varianten voor Utrecht, en ook in beeld als bemand punt.',
    ],
    vervolg:
      'Kiezen tussen kluis en bemand punt; eigenaar polsen en verwachte duur van de leegstand ophalen.',
    bron: {
      label: 'Gedeelde kaartpin',
      url: 'https://maps.app.goo.gl/SHN5qFiz1ZnHvULS7',
    },
  },
  {
    id: 'utrecht-smakkelaarshoek',
    gemeente: 'Utrecht',
    slug: 'utrecht',
    naam: 'Fietsenstalling Smakkelaarshoek',
    lat: 52.0891863,
    lon: 5.1128879,
    type: 'fietsparkeren',
    status: 'uitwerken',
    rang: 3,
    coordBron: 'kaartpin',
    toelichting: [
      'Bewaakte fietsenstalling naast Utrecht Centraal: inpandig, veel passanten en sociale controle, en logisch te combineren met een reis- of loopbeweging.',
      'Stationsgebied is bij uitstek geschikt voor ophalen onderweg, waardoor bezorgritten in de binnenstad vervallen.',
    ],
    vervolg:
      'Beheerder van de stalling identificeren (gemeente, NS of ProRail) en de juiste ingang bepalen.',
    letOp:
      'De gedeelde kaartpin valt bij Moreelsehoek 3A / Hoog Catharijne, terwijl de straat Smakkelaarshoek circa 250 m noordelijker ligt. Bedoelde ingang verifieren.',
    bron: {
      label: 'Gedeelde kaartpin',
      url: 'https://maps.app.goo.gl/9gtzqzBhcPhR6g1w5',
    },
  },
  {
    id: 'utrecht-westraven',
    gemeente: 'Utrecht',
    slug: 'utrecht',
    naam: 'P+R Westraven',
    lat: 52.057498,
    lon: 5.10502,
    type: 'pr',
    status: 'pilot',
    rang: 4,
    coordBron: 'osm',
    toelichting: [
      'Een van de drie concrete varianten voor Utrecht; er is draagvlak bij de gemeente.',
      'Als P+R aan de zuidrand van de stad heeft de locatie weinig inwoners binnen loopafstand; het bereik komt vooral van reizigers die er toch al parkeren of overstappen.',
    ],
    vervolg:
      'Variant naast Sportcentrum Oudenrijn en Vaartsche Rijn uitwerken; bereik vooral via reizigers.',
  },
  {
    id: 'utrecht-papendorp',
    gemeente: 'Utrecht',
    slug: 'utrecht',
    naam: 'P+R Papendorp',
    lat: 52.07297,
    lon: 5.078801,
    type: 'pr',
    status: 'nog-niet-gesproken',
    rang: 5,
    coordBron: 'osm',
    toelichting: [
      'Nog geen gesprek gevoerd over deze locatie; contacten zijn beschikbaar binnen het projectteam.',
      'P+R bij het kantorengebied Papendorp, direct aan de A12 en aan de tramlijn naar het centrum — kansrijk voor werknemers die onderweg ophalen.',
    ],
    vervolg: 'Gesprek inplannen met de beheerder van het terrein.',
  },
  {
    id: 'utrecht-berlijnplein',
    gemeente: 'Utrecht',
    slug: 'utrecht',
    naam: 'P+R Berlijnplein',
    lat: 52.097692,
    lon: 5.069024,
    type: 'pr',
    status: 'nog-niet-gesproken',
    rang: 6,
    coordBron: 'osm',
    toelichting: [
      'Nog geen gesprek gevoerd over deze locatie; contacten zijn beschikbaar binnen het projectteam.',
      'Ligt in Leidsche Rijn Centrum, een gebied dat nog in ontwikkeling is — meekoppelen met de gebiedsontwikkeling is hier mogelijk kansrijker dan losse plaatsing.',
    ],
    vervolg:
      'Gesprek inplannen; nagaan of plaatsing kan meelopen in de gebiedsontwikkeling Leidsche Rijn Centrum.',
  },
  {
    id: 'utrecht-oudenrijn',
    gemeente: 'Utrecht',
    slug: 'utrecht',
    naam: 'Sportcentrum Oudenrijn',
    adres: 'Europaweg 48, 3451 HG Utrecht',
    lat: 52.0886005,
    lon: 5.0232316,
    type: 'sportlocatie',
    status: 'pilot',
    rang: 7,
    coordBron: 'osm',
    toelichting: [
      'Een van de drie concrete varianten voor Utrecht, naast P+R Westraven en Vaartsche Rijn.',
      'Sportcomplex in Vleuterweide (Leidsche Rijn): eigen terrein met parkeerruimte en vaste bezoekersstromen, aan de rand van een jonge woonwijk.',
    ],
    vervolg: 'Plek op het terrein en afspraken met de beheerder van het sportcentrum uitwerken.',
    letOp: 'Coordinaat is het sportcentrum zelf (OpenStreetMap), nog geen exacte kluispositie.',
  },
];

/** Gemeenten met pilotlocaties, in de volgorde waarin ze in de lijst staan. */
export function pilotGemeenten(): Array<{ gemeente: string; slug: string; aantal: number }> {
  const out: Array<{ gemeente: string; slug: string; aantal: number }> = [];
  for (const loc of PILOT_LOCATIONS) {
    const found = out.find((g) => g.slug === loc.slug);
    if (found) found.aantal += 1;
    else out.push({ gemeente: loc.gemeente, slug: loc.slug, aantal: 1 });
  }
  return out;
}

/** Google Street View-panorama op een coordinaat (Maps URLs API). Google kiest
 * zelf het dichtstbijzijnde panorama; is er geen dekking, dan opent de
 * gewone kaartweergave. */
export function streetViewUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}`;
}

/** Afstand in meters tussen twee WGS84-punten. */
export function haversineM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
