import type { TourStep } from '@/components/GuidedTour';

// Guided-tour steps per data-export page, keyed by exact pathname. Targets
// are [data-tour="…"] anchors placed in the page components. Keep 5-15 steps
// per page; write for a beleidsmedewerker seeing the page for the first time.

export const TOUR_STEPS: Record<string, TourStep[]> = {
  '/data-export': [
    {
      target: '[data-tour="tabs"]',
      title: 'Alle analyses onder een dak',
      body: 'Elk tabblad is een eigen analyse op dezelfde pakketpunten-dataset: van ruwe downloads en datamatrix tot pijnpunten, bereik, plaatsingsadvies en de netwerkplanner. Deze rondleiding is per tabblad beschikbaar via de knop Rondleiding.',
    },
    {
      target: '[data-tour="landelijk"]',
      title: 'Landelijke dataset downloaden',
      body: 'Download hier alle pakketpunten van Nederland in een bestand: GeoJSON (voor GIS-software zoals QGIS) of CSV (voor Excel). De data bevat per punt de vervoerder, het type (automaat of servicepunt) en de coordinaten.',
    },
    {
      target: '[data-tour="gemeente-zoek"]',
      title: 'Zoek een gemeente',
      body: 'Typ hier de naam van een gemeente om snel naar de juiste download te springen. Elke gemeente heeft een eigen bestand met alleen haar punten plus de 300/400-meter bufferzones.',
    },
    {
      target: '[data-tour="gemeente-lijst"]',
      title: 'Download per gemeente',
      body: 'Per gemeente kun je JSON of CSV kiezen. Het JSON-bestand bevat naast de punten ook de gemeentegrens en de samengevoegde loopafstand-buffers die je op de kaart ziet.',
    },
    {
      target: '[data-tour="limiet"]',
      title: 'Download-limiet',
      body: 'Er geldt een limiet op het aantal downloads per tijdvak, zodat de server voor iedereen snel blijft. Voor bulk-gebruik kun je beter de publieke API gebruiken (zie /api/v1/docs).',
    },
  ],

  '/data-export/matrix': [
    {
      target: '[data-tour="overzicht"]',
      title: 'Overzicht in een oogopslag',
      body: 'Deze tegels tonen de totalen over heel Nederland: aantal locaties, totaal pakketpunten en het aandeel per vervoerder. Klik op een tegel om de historische ontwikkeling te zien.',
    },
    {
      target: '[data-tour="overzicht"]',
      title: 'Trend over de weken',
      body: 'De dataset wordt wekelijks ververst. Beweeg over een tegel om de trend van de afgelopen weken te zien: groeit of krimpt het netwerk van die vervoerder?',
    },
    {
      target: '[data-tour="matrix-tabel"]',
      title: 'De datamatrix',
      body: 'Elke rij is een gemeente, elke kolom een vervoerder. Zo zie je direct waar een vervoerder sterk of juist afwezig is. De laatste kolommen tonen het totaal en de trend per gemeente.',
    },
    {
      target: '[data-tour="matrix-tabel"]',
      title: 'Klik voor geschiedenis',
      body: 'Gemeentenamen en vervoerder-koppen zijn klikbaar: je krijgt dan een grafiek met het verloop per week. Handig om te controleren of een daling echt is of een meetfout van een bron.',
    },
    {
      target: '[data-tour="leeswijzer"]',
      title: 'Leeswijzer',
      body: 'Hier staat hoe je de cijfers moet lezen: welke bronnen er zijn, wat de beperkingen per vervoerder zijn en hoe dubbeltellingen worden voorkomen.',
    },
  ],

  '/data-export/updates': [
    {
      target: '[data-tour="status"]',
      title: 'Wanneer is de data ververst?',
      body: 'De pakketpunten worden automatisch wekelijks opgehaald bij alle bronnen. Hier zie je het tijdstip van de laatste run en of die volledig geslaagd is.',
    },
    {
      target: '[data-tour="status-overzicht"]',
      title: 'Samenvatting van de run',
      body: 'Drie tellers: hoeveel gemeenten zijn bijgewerkt, hoeveel succesvol en hoeveel mislukt. Een enkele mislukking betekent meestal dat een bron tijdelijk niet bereikbaar was.',
    },
    {
      target: '[data-tour="per-vervoerder"]',
      title: 'Status per vervoerder',
      body: 'Per vervoerder zie je het aantal opgehaalde punten en de status van de laatste run. Vervoerders met webscraping (zoals De Buren en VintedGo) zijn gevoeliger voor storingen dan vervoerders met een echte API.',
    },
    {
      target: '[data-tour="per-vervoerder"]',
      title: 'Dekkingspercentage',
      body: 'De dekking-balk toont welk deel van de gemeenten data van deze vervoerder heeft. Lage dekking hoeft geen fout te zijn: sommige vervoerders zijn simpelweg niet overal actief.',
    },
    {
      target: '[data-tour="logs"]',
      title: 'Volledige logs',
      body: 'Voor de technische details: de volledige update-logs staan in GitHub Actions. Daar zie je per gemeente en per bron precies wat er is opgehaald.',
    },
  ],

  '/data-export/painpoints': [
    {
      target: '[data-tour="intro"]',
      title: 'Pijnpunten volgens carriers',
      body: 'Vervoerders hebben postcodegebieden (PC4) aangeleverd waar zij knelpunten ervaren: te weinig locaties, volle automaten of witte vlekken. Deze pagina bundelt die meldingen.',
    },
    {
      target: '[data-tour="samenvatting"]',
      title: 'De cijfers',
      body: 'Het aantal unieke PC4-gebieden met een melding, het totaal aantal meldingen en hoeveel pakketpunten er nu al in die gebieden staan (uitgesplitst naar automaten en shops).',
    },
    {
      target: '[data-tour="model-toggle"]',
      title: 'Verwacht versus werkelijk',
      body: 'Kies het regressiemodel dat het verwachte aantal punten per PC4 schat: het basismodel (bevolking + oppervlakte) of het K=8-model met acht voorspellers. Zo zie je of een pijnpunt ook statistisch onderbedeeld is.',
    },
    {
      target: '[data-tour="sorteer"]',
      title: 'Sorteer zoals jij wilt',
      body: 'Bouw je eigen sortering met meerdere niveaus, bijvoorbeeld eerst op aantal carrier-meldingen en daarna op inwoners. Zo vind je de gebieden waar de urgentie het hoogst is.',
    },
    {
      target: '[data-tour="pc4-tabel"]',
      title: 'Per postcodegebied',
      body: 'Elke rij is een gemeld PC4-gebied. Klik op een rij om het gebied met alle bestaande pakketpunten op de kaart te zien.',
    },
    {
      target: '[data-tour="per-vervoerder"]',
      title: 'Per vervoerder',
      body: 'Dezelfde meldingen, gegroepeerd per vervoerder. Handig om te zien welke vervoerder waar knelpunten ervaart.',
    },
    {
      target: '[data-tour="per-stad"]',
      title: 'Per stad',
      body: 'En hier gegroepeerd per stad, zodat je in een gesprek met een gemeente direct alle relevante meldingen bij elkaar hebt.',
    },
  ],

  '/data-export/gemeente-painpoints': [
    {
      target: '[data-tour="intro"]',
      title: 'Pijnpunten volgens gemeenten',
      body: 'Naast de carriers hebben ook de G4-gemeenten zelf knelpunt-gebieden aangeleverd. Dit is de bestuurlijke kant van hetzelfde verhaal: waar wil de stad zelf betere voorzieningen?',
    },
    {
      target: '[data-tour="status-g4"]',
      title: 'Status per G4-gemeente',
      body: 'Per gemeente zie je of er data is aangeleverd en hoeveel gebieden zijn gemeld. Niet elke gemeente heeft (al) meldingen aangeleverd.',
    },
    {
      target: '[data-tour="samenvatting"]',
      title: 'De cijfers',
      body: 'Totalen over alle gemeente-meldingen: unieke PC4-gebieden, aantal meldingen en de pakketpunten die er nu staan.',
    },
    {
      target: '[data-tour="pc4-tabel"]',
      title: 'Per postcodegebied',
      body: 'Alle gemelde gebieden in een sorteerbare tabel. Gebieden die ook door carriers zijn gemeld, zijn extra interessant: daar zijn markt en overheid het eens.',
    },
    {
      target: '[data-tour="pc4-tabel"]',
      title: 'Bekijk op de kaart',
      body: 'Klik op een rij om het PC4-gebied te openen met de bestaande pakketpunten erin. Zo beoordeel je meteen of het knelpunt aan de rand of in het hart van het gebied zit.',
    },
  ],

  '/data-export/beleidsprincipes': [
    {
      target: '[data-tour="convenant"]',
      title: 'Het beleidskader',
      body: 'De uitgangspunten uit het Convenant Duurzame Stadslogistiek vormen de basis: minder bezorgbusjes in woonstraten door meer out-of-home bezorging op logische plekken.',
    },
    {
      target: '[data-tour="gemeente-select"]',
      title: 'Kies een gemeente',
      body: 'Beleidsprincipes verschillen per gemeente. Selecteer hier een gemeente om haar specifieke voorkeuren en regels te zien (momenteel is Utrecht uitgewerkt).',
    },
    {
      target: '[data-tour="voorkeur"]',
      title: 'Voorkeursvolgorde',
      body: 'De volgorde waarin een gemeente locaties voor kluizen verkiest, per wijk: bijvoorbeeld eerst bij winkels en OV, daarna pas in de openbare ruimte. Dit stuurt waar een kluis mag landen.',
    },
    {
      target: '[data-tour="uitgangspunten"]',
      title: 'Uitgangspunten buitenplaatsing',
      body: 'Concrete regels voor een kluis in de buitenruimte: zichtlijnen, sociale veiligheid, laden en lossen, ruimtebeslag. Dezelfde criteria komen terug als vlaggetjes in de Netwerkplanner.',
    },
    {
      target: '[data-tour="tabs"]',
      title: 'Van beleid naar kaart',
      body: 'Gebruik deze principes samen met het Plaatsingsadvies (waar zijn extra punten nodig) en de Netwerkplanner (welk netwerk dekt de stad) om van beleid naar concrete locaties te komen.',
    },
  ],

  '/data-export/schatting': [
    {
      target: '[data-tour="intro"]',
      title: 'Hoeveel punten verwacht je ergens?',
      body: 'Deze pagina schat per PC4-gebied hoeveel pakketpunten je zou verwachten op basis van kenmerken als bevolking en voorzieningen. Het verschil met het werkelijke aantal onthult onder- en overbedeling.',
    },
    {
      target: '[data-tour="basismodel"]',
      title: 'Het basismodel',
      body: 'Een eenvoudig regressiemodel op bevolking en oppervlakte. De formule staat er expliciet bij: transparantie boven black box. Dit model wordt ook gebruikt in het Plaatsingsadvies.',
    },
    {
      target: '[data-tour="grafiek-knop"]',
      title: 'Bekijk de spreiding',
      body: 'Klik hier om de puntenwolk te tonen: elk stipje is een PC4-gebied, met de trendlijn erdoorheen. Gebieden ver onder de lijn hebben minder punten dan verwacht.',
    },
    {
      target: '[data-tour="zelf-bouwen"]',
      title: 'Bouw zelf een model',
      body: 'Hier kun je zelf variabelen aan- en uitzetten en direct zien wat dat doet met de verklaringskracht. Zo toets je hypotheses: doet inkomen ertoe? En verkeersveiligheid?',
    },
    {
      target: '[data-tour="snelkeuze"]',
      title: 'Snelkeuzes',
      body: 'De presets zijn goede startpunten, waaronder het beste gevonden model uit een uitputtende zoektocht over miljoenen combinaties (K=8, hoogste verklaringskracht zonder overfitting).',
    },
    {
      target: '[data-tour="variabelen"]',
      title: 'Variabelen per thema',
      body: 'De kandidaat-variabelen zijn gegroepeerd: demografie, inkomen, stedelijkheid, voorzieningen en verkeersveiligheid (BRON-ongevallendata). Vink aan wat je wilt testen.',
    },
    {
      target: '[data-tour="resultaten"]',
      title: 'Lees de coefficienten',
      body: 'Per variabele zie je het effect op het aantal pakketpunten en de VIF-score (multicollineariteit: boven de 5 meet een variabele grotendeels hetzelfde als een andere). R-kwadraat toont hoeveel het model verklaart.',
    },
  ],

  '/data-export/bereik': [
    {
      target: '[data-tour="intro"]',
      title: 'Hoeveel inwoners kunnen erbij?',
      body: 'Deze analyse meet welk deel van de inwoners binnen loopafstand (300/400/500 m hemelsbreed) van een pakketpunt woont — berekend op het CBS 100-meter bevolkingsgrid, niet op gemiddelden.',
    },
    {
      target: '[data-tour="landelijk"]',
      title: 'Het landelijke beeld',
      body: 'Nederland-breed: welk percentage inwoners haalt een punt binnen elke loopafstand. Let op het verschil tussen alle punten en alleen automaten — automaten zijn er veel minder.',
    },
    {
      target: '[data-tour="vergelijk"]',
      title: 'Vergelijk gemeenten',
      body: 'Zet gemeenten naast elkaar. De presets (zoals G4) zijn een snelle start; met het zoekveld voeg je elke gemeente toe. Zo zie je wie voorop loopt en wie achterblijft.',
    },
    {
      target: '[data-tour="controls"]',
      title: 'Afstand en type',
      body: 'Deze knoppen bepalen wat de tabellen hieronder tonen: de loopafstand-norm (300, 400 of 500 meter) en het type punt (alles, alleen shops of alleen automaten). 400 meter is de gangbare beleidsnorm.',
    },
    {
      target: '[data-tour="per-gemeente"]',
      title: 'Ranglijst per gemeente',
      body: 'Alle gemeenten gesorteerd op bereik. Klik op kolomkoppen om te sorteren en gebruik het zoekveld om jouw gemeente te vinden.',
    },
    {
      target: '[data-tour="per-pc4"]',
      title: 'Inzoomen tot PC4',
      body: 'Dezelfde meting per postcodegebied. Hier vind je de concrete witte vlekken: dichtbevolkte PC4-gebieden met een laag bereik zijn de eerste kandidaten voor een nieuwe kluis.',
    },
  ],

  '/data-export/pois': [
    {
      target: '[data-tour="sidebar"]',
      title: 'Publieke voorzieningen als locatiekansen',
      body: 'Deze verkenner toont openbare voorzieningen uit OpenStreetMap: supermarkten, OV-haltes, parkeergarages, trafohuisjes en meer. Precies de plekken waar pakketkluizen kunnen landen.',
    },
    {
      target: '[data-tour="gemeente-select"]',
      title: 'Kies een gemeente',
      body: 'De kaart laadt de voorzieningen per gemeente. Kies er een om te verkennen wat er aan potentiele kluislocaties beschikbaar is.',
    },
    {
      target: '[data-tour="weergave"]',
      title: 'Stippen of iconen',
      body: 'Wissel tussen kleine stippen (overzicht bij veel punten) en herkenbare iconen per categorie (duidelijker bij inzoomen).',
    },
    {
      target: '[data-tour="pijnpunten"]',
      title: 'Combineer met pijnpunten',
      body: 'Zet de pijnpunten-laag aan om de gemelde knelpunt-gebieden over de voorzieningen te leggen. Een supermarkt of tramhalte binnen een pijnpunt-PC4 is een sterke kandidaat-locatie.',
    },
    {
      target: '[data-tour="categorieen"]',
      title: 'Categorieen aan en uit',
      body: 'Elke categorie is een eigen kaartlaag, gegroepeerd per thema (OV, publiek, onderwijs, voorzieningen). Bushaltes zijn er duizenden — zet ze uit als de kaart te druk wordt.',
    },
    {
      target: '[data-tour="kaart"]',
      title: 'De kaart',
      body: 'Klik op een voorziening voor de naam en directe links naar Street View en Google Maps, zodat je de plek meteen visueel kunt beoordelen.',
    },
  ],

  '/data-export/suggesties': [
    {
      target: '[data-tour="intro"]',
      title: 'Waar zijn extra pakketpunten nodig?',
      body: 'Het plaatsingsadvies rangschikt per gemeente de PC4-gebieden op vier signalen: statistische onderbedeling, onbereikte inwoners, adresdichtheid en een overlap-correctie. Voor de top-gebieden stelt het systeem concrete locaties voor.',
    },
    {
      target: '[data-tour="gemeente-bar"]',
      title: 'Gemeente en export',
      body: 'Kies hier de gemeente. Met de CSV-knop exporteer je het volledige advies voor alle gemeenten, inclusief de voorgestelde coordinaten en BAG-panden — een rij per plek.',
    },
    {
      target: '[data-tour="gewichten"]',
      title: 'Draai zelf aan de knoppen',
      body: 'De weging van de vier signalen is instelbaar en je kunt wisselen tussen het basismodel en het K=8-regressiemodel. De ranglijst past zich direct aan — zo test je hoe robuust een advies is.',
    },
    {
      target: '[data-tour="ranking"]',
      title: 'De ranglijst',
      body: 'De top-PC4-gebieden met hun prioriteitsscore en onderliggende signalen. Een badge markeert gebieden die ook als pijnpunt zijn gemeld door carriers of gemeenten — dubbele bevestiging.',
    },
    {
      target: '[data-tour="grote-kaart"]',
      title: 'Voorgestelde locaties op de kaart',
      body: 'Elke pin is een concreet voorstel: het dichtstbevolkte onbediende deel van het PC4-gebied, verschoven naar een echt gebouw (BAG-pand) of een voorziening zoals een supermarkt.',
    },
    {
      target: '[data-tour="poi-toggle"]',
      title: 'Voorzieningen als context',
      body: 'Zet deze laag aan om supermarkten, haltes en andere voorzieningen op de kaart te tonen — per categorie schakelbaar, als iconen of stippen. Zo zie je waarom een voorstel naar een bepaalde plek snapt.',
    },
    {
      target: '[data-tour="detailpaneel"]',
      title: 'Details en plek 1/2/3',
      body: 'Het paneel toont alle details van het geselecteerde voorstel. Met de plek-knoppen wissel je tussen drie iteratief afgeleide locaties binnen hetzelfde PC4-gebied: plek 2 en 3 liggen buiten het bereik van plek 1, dus elke schatting is echte extra winst.',
    },
    {
      target: '[data-tour="detailpaneel"]',
      title: 'Bekijk in 3D',
      body: 'De 3D-knop opent de locatie met een levensechte pakketkluis tegen de gevel van het voorgestelde pand, inclusief luchtfoto, buurgebouwen en het al gedekte gebied. Ideaal voor een gesprek met bewoners of een wethouder.',
    },
    {
      target: '[data-tour="minimaps"]',
      title: 'Alle voorstellen in een oogopslag',
      body: 'Elk kaartje toont een PC4-voorstel met het witte-vlek-gebied en de 400-meter cirkel. Ook hier kun je per kaartje tussen plek 1, 2 en 3 wisselen en direct naar 3D.',
    },
    {
      target: '[data-tour="tabs"]',
      title: 'En dan verder',
      body: 'Wil je in plaats van losse adviezen een compleet dekkend netwerk ontwerpen? Ga dan naar de Netwerkplanner — die plaatst kluizen iteratief tot de hele stad gedekt is.',
    },
  ],

  '/data-export/netwerkplanner': [
    {
      target: '[data-tour="intro"]',
      title: 'Ontwerp het kluizennetwerk van morgen',
      body: 'De Netwerkplanner beantwoordt de vraag: als je N pakketkluizen mag plaatsen, waar zet je ze dan voor maximaal bereik? Het algoritme plaatst kluizen een voor een, telkens op de plek die de meeste nog onbereikte inwoners binnen loopafstand brengt (greedy set-cover).',
    },
    {
      target: '[data-tour="intro"]',
      title: 'Echte locaties, echte bevolkingsdata',
      body: 'Kandidaten zijn geen willekeurige punten maar bestaande voorzieningen uit OpenStreetMap: supermarkten, winkelcentra, stations, tramhaltes, parkeergarages, fietsenstallingen en trafohuisjes. De vraag komt van het CBS 100-meter bevolkingsgrid: elk bewoond blokje van 100 bij 100 meter telt mee.',
    },
    {
      target: '[data-tour="gemeente"]',
      title: 'Werkt voor heel Nederland',
      body: 'Het netwerk is voorberekend voor alle gemeenten. Kies er een — de aanpak is overal identiek, dus resultaten zijn onderling vergelijkbaar.',
    },
    {
      target: '[data-tour="loopafstand"]',
      title: 'De loopafstand-norm',
      body: 'Hoe ver mag een inwoner maximaal van een kluis wonen? 300, 400 of 500 meter (hemelsbreed). Een strengere norm betekent veel meer kluizen voor dezelfde dekking — dit is de belangrijkste beleidskeuze, en je ziet het effect direct.',
    },
    {
      target: '[data-tour="startsituatie"]',
      title: 'Drie startsituaties',
      body: 'Greenfield: de stad heeft nog niets, waar begin je? Bestaande automaten: bouw voort op de kluizen die er al staan. Alle bestaande pakketpunten: ook servicepunten in winkels tellen als gedekt. Vergelijk ze om te zien wat het bestaande netwerk al waard is.',
    },
    {
      target: '[data-tour="ooh-slider"]',
      title: 'Het out-of-home aandeel',
      body: 'Den Haag wil van circa 20 procent naar 80 procent out-of-home bezorging. Deze schuif bepaalt hoeveel pakketten door de kluizen stromen en dus hoeveel kluiscapaciteit er nodig is. De locaties veranderen niet — alleen de capaciteitsberekening.',
    },
    {
      target: '[data-tour="n-slider"]',
      title: 'Bouw het netwerk op',
      body: 'De kern van de tool: schuif van 0 naar het maximum en zie het netwerk kluis voor kluis groeien. Omdat het algoritme altijd de beste volgende plek kiest, zijn de eerste N kluizen automatisch het optimale N-kluizennetwerk.',
    },
    {
      target: '[data-tour="tegels"]',
      title: 'De resultaten in cijfers',
      body: 'Vier tegels: het dekkingspercentage (vergelijk met de start), het aantal inwoners binnen loopafstand, het aantal geplaatste kluizen en de benodigde capaciteit — in kolommen, strekkende meters kluis (49 cm per kolom, maatvoering uit de 3D-viewer) en kasten bij het gekozen out-of-home aandeel.',
    },
    {
      target: '[data-tour="kaart"]',
      title: 'De kaart kleurt groen',
      body: 'Elk stipje is een bewoond CBS-blokje: grijs is al gedekt bij de start, groen wordt gedekt door jouw nieuwe kluizen, rood is nog een witte vlek. Schuif met het aantal kluizen en zie de stad letterlijk groen kleuren.',
    },
    {
      target: '[data-tour="kaart"]',
      title: 'Kluizen op de kaart',
      body: 'De gekleurde cirkels zijn de geplaatste kluizen, in de kleur van hun locatietype. Klik erop voor de details en een 3D-weergave. Met het vinkje linksonder toon je ook de loopafstand-cirkel per kluis.',
    },
    {
      target: '[data-tour="picks"]',
      title: 'De plaatsingsvolgorde',
      body: 'De lijst toont elke kluis in volgorde van impact: nummer 1 bereikt de meeste nieuwe inwoners. Per kluis zie je het locatietype, de naam, het aantal nieuw bereikte inwoners en het benodigde aantal kolommen.',
    },
    {
      target: '[data-tour="picks"]',
      title: 'Vlaggen voor de praktijk',
      body: 'De labels vertalen de plaatsingscriteria van de gemeente: OV-nabij, sociale controle, 24/7 toegankelijke buitenruimte, of juist een aandachtspunt voor sociale veiligheid (zoals een afgelegen trafohuisje). Geen harde uitsluitingen — wel eerlijke context.',
    },
    {
      target: '[data-tour="picks"]',
      title: 'Elke kluis in 3D',
      body: 'Via Bekijk in 3D zie je de kluis op ware grootte op de gekozen locatie, met luchtfoto en 3D-gebouwen. Het aantal kolommen uit de capaciteitsberekening wordt meegenomen, dus de kast heeft meteen de juiste maat.',
    },
    {
      target: '[data-tour="curve"]',
      title: 'De wet van de afnemende meerwaarde',
      body: 'De curve toont dekking versus aantal kluizen. De eerste kluizen leveren duizenden inwoners op, daarna vlakt het af — het oranje merkteken markeert dat omslagpunt. De gestippelde lijnen tonen dezelfde opbouw bij de andere loopafstanden: zo zie je in een oogopslag wat een strengere norm kost.',
    },
    {
      target: '[data-tour="aannames"]',
      title: 'Transparante aannames',
      body: 'Alle aannames staan hier open en bloot: hemelsbrede afstand, CBS-grid als vraagbron, OSM-locaties als kandidaten en het capaciteitsmodel (24 pakketten per inwoner per jaar, 1,5 dag verblijftijd, 85 procent bezetting). Verdedigbaar in elke raadszaal.',
    },
  ],
};
