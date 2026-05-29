import Image from 'next/image';

type Block =
  | { kind: 'p'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'numbered'; items: { title: string; text: string }[] }
  | { kind: 'subhead'; text: string };

type QA = {
  question: string;
  blocks: Block[];
};

type CarrierProcess = {
  id: string;
  name: string;
  logo: string;
  initiative?: string;
  channel?: { label: string; href?: string };
  flow?: string;
  qa?: QA[];
};

const carriers: CarrierProcess[] = [
  {
    id: 'vintedgo',
    name: 'VintedGo',
    logo: '/logos/vintedgo.svg',
    initiative:
      'Vooralsnog ligt het initiatief en het contact met de gemeenten primair bij de ondernemers zelf die de aanvraag voor de lockers indienen.',
    channel: {
      label: 'Landelijke Omgevingsloket (omgevingsloket.nl)',
      href: 'https://omgevingsloket.nl',
    },
    flow:
      'Ondernemers moeten hier een omvangrijke en lange vragenlijst invullen om de aanvraag te starten. Het proces is daardoor vaak complex en tijdrovend voor de aanvrager, waarna de gemeente de beoordeling start.',
  },
  {
    id: 'postnl',
    name: 'PostNL',
    logo: '/logos/postnl.svg',
    qa: [
      {
        question:
          'Waar liggen voor jullie de grootste pijnpunten bij het aanvragen van een pakketkluis bij een gemeente?',
        blocks: [
          {
            kind: 'p',
            text:
              'De grootste uitdaging zit voor ons vaak in het ontbreken van een uniforme aanpak tussen gemeenten én soms zelfs binnen gemeenten zelf. De beoordeling raakt meerdere domeinen tegelijk (openbare ruimte, verkeer, vergunningen, vastgoed, duurzaamheid, sport, gebiedsteams), waardoor trajecten regelmatig vertragen door interne afstemming.',
          },
          {
            kind: 'p',
            text:
              'Daarnaast merken we dat criteria vooraf niet altijd duidelijk zijn. Denk aan:',
          },
          {
            kind: 'list',
            items: [
              'wel of geen plaatsing op gemeentegrond;',
              'eisen rondom zichtlocaties;',
              'beheer- en onderhoudsafspraken;',
              'participatievereisten;',
              'of de vraag of een pakketkluis wordt gezien als commerciële voorziening of maatschappelijke infrastructuur.',
            ],
          },
          {
            kind: 'p',
            text:
              'Hierdoor ontstaat regelmatig maatwerk per locatie, wat de doorlooptijd aanzienlijk verlengt (OPA vs BOPA = hogere legeskosten).',
          },
        ],
      },
      {
        question: 'Waar zitten de grootste verschillen tussen steden?',
        blocks: [
          {
            kind: 'p',
            text:
              'De verschillen zitten vooral in de mate waarin gemeenten al een bredere visie hebben op stadslogistiek en multifunctioneel ruimtegebruik.',
          },
          {
            kind: 'p',
            text:
              'Gemeenten waar logistiek, mobiliteit en leefbaarheid integraal worden bekeken, bewegen doorgaans sneller en pragmatischer. In andere steden zien we dat aanvragen meer versnipperd worden behandeld per afdeling, waardoor besluitvorming langer duurt of minder voorspelbaar wordt.',
          },
          {
            kind: 'p',
            text:
              'Daarnaast verschilt de houding ten opzichte van plaatsing op semipublieke locaties sterk. Sommige gemeenten staan meer open voor oplossingen bij bijvoorbeeld sportverenigingen, wijkhubs of mobiliteitslocaties, terwijl andere gemeenten vooral kijken vanuit traditionele vergunning- of openbare ruimte kaders.',
          },
          { kind: 'subhead', text: 'Een paar concrete voorbeelden' },
          {
            kind: 'list',
            items: [
              'Zoetermeer: aanvragen worden initieel afgewezen, waarna ze verplicht moeten worden ingetrokken om legeskosten te voorkomen. Vervolgens wordt eerst gestuurd op afstemming van de huurovereenkomst voor de grond, om daarna alsnog de vraag te krijgen of het vergunningstraject al is gestart. Dit komt over als tegenstrijdig beleid binnen dezelfde gemeente.',
              'Hoogvliet: inmiddels hebben wij twee aanvragen moeten intrekken om deze vervolgens opnieuw in te dienen. Het wekt sterk de indruk dat verschillende afdelingen ieder hun eigen werkwijze en uitgangspunten hanteren, zonder onderlinge afstemming.',
              "Westland, 's-Hertogenbosch en Oldebroek: wijzen iets af maar komen altijd met alternatieven.",
            ],
          },
          { kind: 'subhead', text: 'En uit de G4' },
          {
            kind: 'list',
            items: [
              'Amsterdam: wijst standaard alles af, geeft niet het gevoel dat ze zaken afwegen — het is altijd "nee".',
              'Rotterdam: heel kritisch, ondanks dat er een aantal prima locaties zijn waarin het wél gelukt is. Verdere schaling lijkt voorlopig niet haalbaar; vaak wordt gesteld dat er in de toekomst misschien ruimte komt.',
              'Den Haag en Utrecht: pittige trajecten (veel tijd en moeite vanuit onze kant, inclusief diverse alternatieven en handreikingen) en wijzen dan alsnog vaak af.',
            ],
          },
        ],
      },
      {
        question: 'Wat zou volgens jullie het meest helpen om dit te verbeteren?',
        blocks: [
          { kind: 'p', text: 'Wat ons betreft zit de grootste winst in:' },
          {
            kind: 'list',
            items: [
              'één gemeentelijk aanspreekpunt of regisseur per stad;',
              'meer uniforme beoordelingscriteria tussen gemeenten;',
              'duidelijkere richtlijnen voor plaatsing op gemeentegrond of maatschappelijke locaties;',
              'implementeren in het Omgevingsloket (Omgevingswet) via de Vereniging van Nederlandse Gemeenten (post- en pakketsector);',
              'een gezamenlijke langetermijnvisie op pakketlogistiek als onderdeel van leefbare en duurzame steden.',
            ],
          },
          {
            kind: 'p',
            text:
              'Wij denken daarnaast dat multifunctionele locaties, zoals sportverenigingen of wijkhubs, hierin een belangrijke rol kunnen spelen. Daarmee kan pakketlogistiek worden gekoppeld aan bestaande maatschappelijke infrastructuur, met minder druk op de openbare ruimte en meer lokale meerwaarde voor bewoners en verenigingen.',
          },
        ],
      },
    ],
  },
  {
    id: 'dpd',
    name: 'DPD',
    logo: '/logos/dpd.svg',
    qa: [
      {
        question: 'Achtergrond en scope',
        blocks: [
          {
            kind: 'p',
            text:
              'Wij hebben inmiddels meer dan 50 omgevingsvergunningen aangevraagd en zijn hier al een aantal jaar mee bezig.',
          },
          {
            kind: 'p',
            text:
              'Het gaat hier specifiek om de aanvraag van omgevingsvergunningen voor pakketautomaten op particulier terrein, bijvoorbeeld bij retailers, tankstations of sportverenigingen. Plaatsing op gemeentelijke grond of in de openbare ruimte komt in de praktijk namelijk nog nauwelijks voor. Met verschillende gemeenten hebben wij hierover wel gesprekken gevoerd, maar dit loopt vaak vast doordat:',
          },
          {
            kind: 'list',
            items: [
              'er beperkt ruimte beschikbaar is in de openbare ruimte;',
              'gemeenten niet zomaar grond aan één partij mogen toewijzen zonder tenderprocedure;',
              'initiatieven regelmatig conceptueel blijven en niet tot uitvoering komen. Er zijn in het verleden wel interessante initiatieven geweest, zoals mobiliteitshubs met elektrisch vervoer en pakketautomaten (bijvoorbeeld bij station Alkmaar Noord). Meer concrete uitvoering van dit soort initiatieven zou enorm helpen.',
            ],
          },
        ],
      },
      {
        question: 'Belangrijkste pijnpunten in de vergunningaanvraag',
        blocks: [
          {
            kind: 'numbered',
            items: [
              {
                title: 'Verschillen in beleid per gemeente',
                text:
                  'Er is momenteel geen uniform landelijk beleid rondom pakketautomaten. Iedere gemeente hanteert eigen criteria, procedures, interpretaties en kosten. Voor landelijke uitrol betekent dit dat wij bij iedere aanvraag opnieuw moeten uitvinden hoe een gemeente ermee omgaat.',
              },
              {
                title: 'Doorlooptijden en gebrek aan contactpersonen',
                text:
                  'De reguliere procedure bedraagt officieel 8 weken, met mogelijke verlenging van 6 weken. In de praktijk lopen aanvragen echter regelmatig maanden vertraging op. Daarnaast ontbreekt tijdens de behandeling vaak een direct contactpersoon binnen de gemeente, waardoor tussentijdse afstemming of statusupdates nauwelijks mogelijk zijn.',
              },
              {
                title: 'Onduidelijke criteria voor vergunningplicht',
                text:
                  'Ondanks juridische toetsing blijft het onduidelijk wanneer exact een omgevingsvergunning vereist is. Met name de interpretatie of een pakketautomaat op voorerf of achtererf staat en de criteria "andere functie dan de bestemming" verschilt sterk per gemeente. Bij tankstations met een winkeltje kan worden beargumenteerd dat een pakketautomaat binnen een retailfunctie past (al is het de vraag of een pakketautomaat wel een retailfunctie is). Ook bij sportverenigingen zien we grote verschillen: de meeste gemeenten wijzen aanvragen bij voetbalclubs af omdat een pakketautomaat niet binnen de bestemming "sport" zou passen. Tegelijkertijd zijn clubs en omwonenden vaak juist positief vanwege de extra dienstverlening en inkomsten. Andere gemeenten, zoals Oldenzaal en Wijhe, staan hier juist zeer positief tegenover.',
              },
              {
                title: 'Grote verschillen in aanvullende eisen',
                text:
                  'Sommige gemeenten vragen bijvoorbeeld participatietrajecten met buurtbewoners, aanwezigheid bij buurtbijeenkomsten, enquêteonderzoek, of geluidsonderzoeken (decibel van het sluiten van de compartimenten). Een deel van die criteria is niet realistisch of niet van toepassing. Andere gemeenten zijn juist zeer meewerkend en stimuleren plaatsing actief. Hierdoor is het de facto een "trial and error"-proces voor meer dan 300 gemeenten.',
              },
              {
                title: 'Bezwaarprocedures',
                text:
                  'Ook na vergunningverlening geldt vaak nog een bezwaartermijn van 6 weken. Dit vertraagt de plaatsing verder en brengt aanvullende administratieve en juridische werkzaamheden met zich mee, zelfs nadat een vergunning al is goedgekeurd.',
              },
              {
                title: 'Hoge en onvoorspelbare kosten',
                text:
                  'Gemeenten hanteren sterk uiteenlopende legeskosten. Deze zijn vooraf niet inzichtelijk en kunnen fors oplopen — een voorbeeld is gemeente Goirle, waar de kosten opliepen tot € 2.394. Ook bij afwijzing worden de kosten doorgaans doorbelast. In sommige gemeenten is daarnaast eerst een conceptverzoek verplicht, wat de kosten verder verhoogt. Dit heeft directe impact op de haalbaarheid van de businesscase.',
              },
              {
                title: 'Nadeelcompensatie en juridische onzekerheid',
                text:
                  'In sommige gevallen wordt gevraagd een overeenkomst voor nadeelcompensatie te ondertekenen, waarbij wij aansprakelijk kunnen worden gesteld voor eventuele schadeclaims van derden als gevolg van plaatsing van de automaat. Dit brengt zowel juridische kosten als onzekerheid met zich mee.',
              },
              {
                title: 'Ongelijkheid in handhaving',
                text:
                  'In de praktijk werkt het volgen van de formele procedure soms averechts: wij maken kosten voor aanvragen, die worden afgewezen, terwijl andere partijen zonder procedure wél een pakketautomaat neerzetten. In sommige gevallen geven gemeenten aan dat hierbij geen sprake is van precedentwerking omdat de andere partij "de procedure niet heeft gevolgd". Dit beleid is voor ons lastig te volgen.',
              },
              {
                title: 'Gebrek aan constructieve afstemming',
                text:
                  'Bij sommige gemeenten ontbreekt praktische begeleiding naar een geschikte locatie. Voorbeeld: gemeente Deurne wees een aanvraag bij een NS-station af met het verzoek een alternatieve locatie aan te vragen. Ook die vervolgaanvraag werd vervolgens afgewezen, zonder inhoudelijke begeleiding over welke locaties wél wenselijk of kansrijk zouden zijn.',
              },
            ],
          },
        ],
      },
      {
        question: 'Wat ons het meest zou helpen',
        blocks: [
          {
            kind: 'list',
            items: [
              'meer landelijke harmonisatie van beleid en criteria;',
              'duidelijkheid vooraf over vergunningplicht, kosten en doorlooptijden;',
              'vaste contactpersonen of één loket per gemeente (inclusief statusupdates van aanvragen);',
              'meer ruimte voor pakketautomaten binnen maatschappelijke functies zoals sportverenigingen;',
              'meer concrete initiatieven vanuit gemeenten voor plaatsing in de openbare ruimte of bij mobiliteitshubs.',
            ],
          },
        ],
      },
    ],
  },
  { id: 'dhl', name: 'DHL', logo: '/logos/dhl.svg' },
  { id: 'deburen', name: 'De Buren', logo: '/logos/deburen.png' },
  { id: 'inpost', name: 'InPost', logo: '/logos/inpost.svg' },
  { id: 'budbee', name: 'Budbee', logo: '/logos/budbee.svg' },
  { id: 'gls', name: 'GLS', logo: '/logos/gls.svg' },
  { id: 'amazon', name: 'Amazon', logo: '/logos/amazon.svg' },
  { id: 'viatim', name: 'ViaTim', logo: '/logos/viatim.svg' },
];

function renderBlock(b: Block, idx: number) {
  if (b.kind === 'p') {
    return (
      <p key={idx} className="text-gray-800">
        {b.text}
      </p>
    );
  }
  if (b.kind === 'list') {
    return (
      <ul key={idx} className="list-disc list-outside pl-5 space-y-1 text-gray-800">
        {b.items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    );
  }
  if (b.kind === 'numbered') {
    return (
      <ol key={idx} className="list-decimal list-outside pl-5 space-y-2 text-gray-800 marker:font-semibold marker:text-gray-500">
        {b.items.map((it, i) => (
          <li key={i}>
            <span className="font-semibold text-gray-900">{it.title}</span>
            {it.title && ' — '}
            <span>{it.text}</span>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <div
      key={idx}
      className="text-xs font-semibold uppercase tracking-wide text-gray-600 mt-2"
    >
      {b.text}
    </div>
  );
}

export default function ProcesgangPage() {
  return (
    <>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Procesgang aanvraag pakketpunt</h2>
        <p className="text-sm text-gray-600 mt-1">
          Per vervoerder beschrijven we hoe een aanvraag voor een nieuw pakketpunt of locker
          tot stand komt: wie neemt het initiatief, via welk kanaal verloopt het, en hoe ziet
          de procesgang er voor de aanvrager en de gemeente uit.
        </p>
      </div>

      <div className="space-y-4">
        {carriers.map((c) => {
          const hasContent = Boolean(c.initiative || c.channel || c.flow || c.qa?.length);
          return (
            <section
              key={c.id}
              className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden"
            >
              <header className="flex items-center gap-3 px-5 py-3 border-b border-gray-100 bg-gray-50">
                <div className="w-10 h-10 flex items-center justify-center bg-white rounded border border-gray-200">
                  <Image
                    src={c.logo}
                    alt={c.name}
                    width={28}
                    height={28}
                    className="object-contain"
                  />
                </div>
                <h3 className="text-base font-semibold text-gray-900">{c.name}</h3>
              </header>

              <div className="px-5 py-4 text-sm text-gray-800 space-y-4">
                {!hasContent && (
                  <p className="text-gray-500 italic">
                    Nog geen informatie ontvangen.
                  </p>
                )}

                {c.initiative && (
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">
                      Initiatief en contact
                    </div>
                    <p>{c.initiative}</p>
                  </div>
                )}

                {c.channel && (
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">
                      Kanaal
                    </div>
                    <p>
                      {c.channel.href ? (
                        <a
                          href={c.channel.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 underline"
                        >
                          {c.channel.label}
                        </a>
                      ) : (
                        c.channel.label
                      )}
                    </p>
                  </div>
                )}

                {c.flow && (
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">
                      Procesgang
                    </div>
                    <p>{c.flow}</p>
                  </div>
                )}

                {c.qa && c.qa.length > 0 && (
                  <div className="space-y-5">
                    {c.qa.map((qa, qi) => (
                      <div
                        key={qi}
                        className="border-l-2 border-blue-200 pl-4 py-1 space-y-2"
                      >
                        <h4 className="text-sm font-semibold text-gray-900">
                          {qa.question}
                        </h4>
                        <div className="space-y-2 text-sm leading-relaxed">
                          {qa.blocks.map((b, bi) => renderBlock(b, bi))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
