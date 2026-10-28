// Shapes of webapp/public/data/forecast/*.json, written by scripts/forecast_growth.py.

export type Granularity = 'week' | 'maand' | 'jaar';
export type Scenario = 'laag' | 'midden' | 'hoog';
export type Category = 'locker' | 'shop';
export type Betrouwbaarheid = 'hoog' | 'middel' | 'laag';

/** One value per period of a granularity; null where not applicable. */
export type PeriodSeries = Record<Granularity, (number | null)[]>;

/** Stock quantiles per granularity. History periods are null except the last one. */
export type QuantileSeries = Record<Granularity, { p10: (number | null)[]; p50: (number | null)[]; p90: (number | null)[] }>;

export interface StockFlow {
  stock: QuantileSeries;
  flow?: PeriodSeries;
}

export interface ScenarioBlock {
  punten: StockFlow;
  categorie: Record<Category, StockFlow>;
  /** Median stock per carrier x category, month and year only (history + forecast). */
  per_vervoerder: Record<string, Partial<Record<Category, Partial<Record<'maand' | 'jaar', (number | null)[]>>>>>;
  locaties: StockFlow;
  locaties_multi: StockFlow;
  plafond?: PeriodSeries;
}

export interface Headline {
  nu: number;
  y2030: number;
  y2030_laag: number;
  y2030_hoog: number;
  cagr_pct: number;
  locaties_nu: number;
  locaties_2030: number;
  aandeel_automaat_nu_pct: number;
  aandeel_automaat_2030_pct?: number;
  punten_per_locatie_nu: number;
  punten_per_locatie_2030: number;
  multi_aandeel_nu_pct: number;
  multi_aandeel_2030_pct?: number;
}

export interface OlsFit {
  intercept: number;
  helling: number;
  se: number;
  r2: number | null;
  n: number;
  groei_per_jaar_pct?: number;
  groei_per_jaar_95?: [number, number];
}

export interface Reliability {
  n_now: number;
  weeks_clean: number;
  noise_cv: number;
  snr: number;
  shrinkage_weight: number;
  backtest_fout_pct: number;
  backtest_naief_pct: number;
  pi_rel_width_2030: number | null;
  betrouwbaarheid: Betrouwbaarheid;
  redenen: string[];
  /** OLS of cumulative organic additions on the week number: points per week. */
  trend_eigen_data: OlsFit | null;
}

export interface ForecastEvent {
  carrier: string;
  type: string;
  week: string;
  until?: string;
  source: 'register' | 'auto';
  note?: string;
  change_pct?: number;
  label: string;
}

export interface Backtest {
  methode: string;
  mape_model: number;
  mape_naive: number;
  mape_linear: number;
  onzekerheid_factor: number;
  dekking_p10_p90_pct: number;
  dekking_ongekalibreerd_pct: number;
  per_startpunt: { week: string; werkelijke_groei_pct: number; voorspelde_groei_pct: number }[];
  gemeenten_per_grootte: { klasse: string; gemeenten: number; fout_model_pct: number; fout_naief_pct: number }[];
  allocatie_dispersie: number;
}

interface ForecastBase {
  generated_at: string;
  slug: string;
  naam: string;
  last_week: string;
  periods: Record<Granularity, string[]>;
  /** Index of the last history period per granularity; forecast starts after it. */
  forecast_from: Record<Granularity, number>;
  headline: Headline;
  scenarios: Record<Scenario, ScenarioBlock>;
}

export interface NationalForecast extends ForecastBase {
  history: {
    punten_raw: PeriodSeries;
    punten_clean: PeriodSeries;
    locaties_raw: PeriodSeries;
    locaties_clean: PeriodSeries;
    punten_trend_ols: PeriodSeries;
    /** Fitted OLS line per chart view: punten, locaties, locker, shop. */
    trend_ols: Record<'punten' | 'locaties' | Category, PeriodSeries>;
    locaties_multi_raw: PeriodSeries;
    categorie_raw: Record<Category, PeriodSeries>;
    groei_week_pct: (number | null)[];
  };
  events: ForecastEvent[];
  carriers: string[];
  backtest: Backtest;
  regressies: {
    totaal: OlsFit;
    locaties: OlsFit | null;
    categorie: Record<Category, OlsFit | null>;
    per_reeks: Record<string, OlsFit | null>;
    multi_vs_ratio: OlsFit;
  };
  fits: Record<string, { slope: number; slope_se: number; sigma: number; n_obs: number }>;
  markt: { helling_per_week: number; se: number; multi_beta: number };
  plafond_dichtheid_per_1000: Record<string, number>;
  methodology: Record<string, string | Record<string, Record<string, number>>>;
}

export interface GemeenteForecast extends ForecastBase {
  provincie: string;
  stedelijkheid: number | null;
  inwoners: number | null;
  reliability: Reliability;
  history: {
    punten_raw: PeriodSeries;
    /** Today's count minus organic growth still to come (no intro jumps). */
    punten_clean: PeriodSeries;
    /** OLS line of the cleaned series (Reliability.trend_eigen_data). */
    punten_trend_ols?: PeriodSeries;
    locaties_raw: PeriodSeries;
    locaties_multi_raw: PeriodSeries;
    categorie_raw: Record<Category, PeriodSeries>;
  };
}

export type AnyForecast = NationalForecast | GemeenteForecast;

export interface ForecastIndexRow extends Headline {
  slug: string;
  naam: string;
  provincie: string;
  stedelijkheid: number | null;
  inwoners: number | null;
  groei_2030: number;
  groei_locaties_2030: number;
  betrouwbaarheid: Betrouwbaarheid;
  shrinkage_weight: number;
  backtest_fout_pct: number;
  pi_rel_width_2030: number | null;
}

export interface ForecastIndex {
  generated_at: string;
  last_week: string;
  gemeenten: ForecastIndexRow[];
}

export function isNational(f: AnyForecast): f is NationalForecast {
  return f.slug === 'nederland';
}

/* -------- webapp/public/data/forecast_placements/*.json (scripts/forecast_placements.py) */

export interface PlacementHost {
  lat: number;
  lon: number;
  bron: string;
  adres?: string | null;
  afstand_m?: number;
}

export interface ForecastPick {
  rank: number;
  year: string;
  pc4: string;
  lat: number;
  lon: number;
  terrein: 'publiek' | 'privaat' | 'onbekend';
  terrein_bron: string;
  privaat: PlacementHost | null;
  publiek: PlacementHost | null;
  privaat_niet_invulbaar: boolean;
  est_new_pop_within_400m: number | null;
  marginal: boolean;
  adres: string | null;
  witte_vlek_lat: number;
  witte_vlek_lon: number;
}

export interface PlacementYear {
  year: string;
  nieuwe_punten: number;
  nieuwe_locaties: number;
  co_locatie: number;
  witte_vlek: number;
  verdichting: number;
  witte_vlek_zonder_plek: number;
}

export interface PlacementSummary {
  per_terrein: Record<'publiek' | 'privaat' | 'onbekend', number>;
  plekken: number;
  privaat_niet_invulbaar: number;
  aandeel_publiek_nodig_pct: number | null;
  witte_vlek_zonder_plek: number;
}

export interface ForecastPlacements {
  generated_at: string;
  slug: string;
  naam: string;
  scenario: Scenario;
  stedelijkheid: number | null;
  aandeel_witte_vlek_pct: number;
  poi_terrein_beschikbaar: boolean;
  punten_nu: number;
  locaties_nu: number;
  years: PlacementYear[];
  picks: ForecastPick[];
  densification: { year: string; pc4: string; count: number }[];
  summary: PlacementSummary;
}

export interface ForecastPlacementsIndex {
  generated_at: string;
  scenario: Scenario;
  landing: Record<string, { co_locatie: number; verdichting: number; witte_vlek: number; aandeel_witte_vlek_pct: number }>;
  national: Omit<PlacementSummary, 'per_terrein'> & {
    nieuwe_locaties: number;
    co_locatie: number;
    witte_vlek: number;
    verdichting: number;
  };
  gemeenten: (Omit<PlacementSummary, 'per_terrein'> & {
    slug: string;
    naam: string;
    nieuwe_locaties: number;
    co_locatie: number;
    witte_vlek: number;
    verdichting: number;
    per_terrein: PlacementSummary['per_terrein'];
  })[];
}
