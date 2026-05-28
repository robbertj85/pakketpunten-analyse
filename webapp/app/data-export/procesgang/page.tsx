import Image from 'next/image';

type CarrierProcess = {
  id: string;
  name: string;
  logo: string;
  initiative?: string;
  channel?: { label: string; href?: string };
  flow?: string;
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
  { id: 'dhl', name: 'DHL', logo: '/logos/dhl.svg' },
  { id: 'postnl', name: 'PostNL', logo: '/logos/postnl.svg' },
  { id: 'dpd', name: 'DPD', logo: '/logos/dpd.svg' },
  { id: 'deburen', name: 'De Buren', logo: '/logos/deburen.png' },
  { id: 'inpost', name: 'InPost', logo: '/logos/inpost.svg' },
  { id: 'budbee', name: 'Budbee', logo: '/logos/budbee.svg' },
  { id: 'gls', name: 'GLS', logo: '/logos/gls.svg' },
  { id: 'amazon', name: 'Amazon', logo: '/logos/amazon.svg' },
  { id: 'viatim', name: 'ViaTim', logo: '/logos/viatim.svg' },
];

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
          const hasContent = Boolean(c.initiative || c.channel || c.flow);
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

              <div className="px-5 py-4 text-sm text-gray-800 space-y-3">
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
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
