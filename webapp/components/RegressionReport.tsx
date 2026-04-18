'use client';

import { useMemo, useState } from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ZAxis, Legend,
} from 'recharts';
import {
  fitModel, ols, bic, cohensF2, cohensF2Label, partialF, type ModelFit,
} from '@/utils/regression';
import type { PainpointsPayload, ScatterPoint } from './PainpointsReport';

// ---- Model builder configuration ----
// Keys match ScatterPoint fields so we can read them directly.
type FeatureKey =
  | 'pop' | 'area'
  | 'avg_income' | 'pct_low_income' | 'pct_high_income' | 'avg_woz'
  | 'ses_total' | 'ses_welvaart' | 'ses_arbeid'
  | 'urbanity' | 'oad' | 'pct_age_25_45' | 'pct_single_hh'
  | 'pct_multi_family' | 'pct_owner_occupied'
  | 'horeca_1km' | 'supermarket_1km' | 'station_km' | 'highway_km';

interface FeatureDef {
  key: FeatureKey;
  label: string;
  group: 'basis' | 'inkomen' | 'ses' | 'stedelijk' | 'voorzieningen';
  help: string;
  unit?: string;
}

const FEATURE_DEFS: FeatureDef[] = [
  { key: 'pop', label: 'Inwoners', group: 'basis', help: 'CBS 83502NED' },
  { key: 'area', label: 'Oppervlakte (km²)', group: 'basis', help: 'PC4-polygoon in EPSG:28992' },
  { key: 'avg_income', label: 'Gem. besteedbaar inkomen / huishouden', group: 'inkomen', unit: '× €1 000', help: 'CBS Kerncijfers 2022' },
  { key: 'pct_low_income', label: '% huishoudens met laag inkomen', group: 'inkomen', unit: '%', help: 'CBS Kerncijfers 2022' },
  { key: 'pct_high_income', label: '% huishoudens met hoog inkomen', group: 'inkomen', unit: '%', help: 'CBS Kerncijfers 2022' },
  { key: 'avg_woz', label: 'Gem. WOZ-waarde woning', group: 'inkomen', unit: '× €1 000', help: 'CBS Kerncijfers 2022' },
  { key: 'ses_total', label: 'SES-WOA totaalscore', group: 'ses', help: 'CBS maatwerk 2024/24' },
  { key: 'ses_welvaart', label: 'SES-WOA deelscore welvaart', group: 'ses', help: 'CBS maatwerk 2024/24' },
  { key: 'ses_arbeid', label: 'SES-WOA deelscore arbeidsverleden', group: 'ses', help: 'CBS maatwerk 2024/24' },
  { key: 'urbanity', label: 'Stedelijkheid (1-5)', group: 'stedelijk', help: 'CBS ordinaal: 1=zeer sterk stedelijk, 5=niet stedelijk' },
  { key: 'oad', label: 'Omgevingsadressendichtheid', group: 'stedelijk', unit: 'adressen/km²', help: 'CBS: dichtheid van adressen in omgeving' },
  { key: 'pct_age_25_45', label: '% inwoners 25-45 jaar', group: 'stedelijk', unit: '%', help: 'Piek-leeftijd online shoppen' },
  { key: 'pct_single_hh', label: '% eenpersoonshuishoudens', group: 'stedelijk', unit: '%', help: 'Zware e-commerce-verbruikers' },
  { key: 'pct_multi_family', label: '% meergezinswoningen', group: 'stedelijk', unit: '%', help: 'Flats: vaker mislukte bezorging' },
  { key: 'pct_owner_occupied', label: '% koopwoningen', group: 'stedelijk', unit: '%', help: 'CBS Kerncijfers 2022' },
  { key: 'horeca_1km', label: 'Horeca binnen 1 km', group: 'voorzieningen', unit: 'vestigingen', help: 'Café + cafetaria + restaurant — host-locaties voor pakketpunten' },
  { key: 'supermarket_1km', label: 'Grote supermarkten binnen 1 km', group: 'voorzieningen', unit: 'vestigingen', help: 'Supermarkten huisvesten automaten + servicepunten' },
  { key: 'station_km', label: 'Afstand tot treinstation', group: 'voorzieningen', unit: 'km', help: 'OV-knooppunten trekken pickup-locaties' },
  { key: 'highway_km', label: 'Afstand tot snelwegoprit', group: 'voorzieningen', unit: 'km', help: 'Bezorgroute-efficiëntie' },
];

const GROUP_LABELS: Record<FeatureDef['group'], string> = {
  basis: 'Omvang & ruimte',
  inkomen: 'Inkomen & welvaart (CBS 2022)',
  ses: 'SES-WOA (CBS 2022, incl. studenten)',
  stedelijk: 'Stedelijkheid & bevolking',
  voorzieningen: 'Voorzieningen & bereikbaarheid',
};

// Curated presets from scripts/find_best_model.py so users can jump to
// known strong combinations without re-running the search themselves.
const MODEL_PRESETS: Array<{ name: string; keys: FeatureKey[]; note: string }> = [
  { name: 'Basis', keys: ['pop', 'area'], note: 'Oorspronkelijke Python-baseline' },
  {
    name: 'Ockham (k=4)',
    keys: ['pop', 'pct_low_income', 'oad', 'horeca_1km'],
    note: 'Beste 4-variabelenmodel uit best-subset search',
  },
  {
    name: 'Elbow (k=7)',
    keys: ['pop', 'area', 'avg_woz', 'oad', 'pct_single_hh', 'horeca_1km', 'supermarket_1km'],
    note: 'Parsimonieus — ΔR² < 0.003 t.o.v. k+1',
  },
];

/** Tooltip copy for the remove button. Explains whether dropping this
 *  variable is "safe" based on its VIF and leave-one-out Drop-F. */
function removeTooltip(
  label: string,
  vif: number | undefined,
  drop: { F: number; p: number; deltaR2: number } | undefined,
): string {
  const base = `Verwijder '${label}' uit het model.`;
  const lines = [base];
  if (vif != null && Number.isFinite(vif)) {
    if (vif > 10) lines.push(`VIF ${vif.toFixed(1)} — sterk collineair met de andere variabelen. Veilig om te droppen.`);
    else if (vif > 5) lines.push(`VIF ${vif.toFixed(1)} — matige overlap met andere variabelen.`);
    else lines.push(`VIF ${vif.toFixed(2)} — geen collineariteitsprobleem.`);
  }
  if (drop) {
    if (drop.p >= 0.05) {
      lines.push(`Drop-F ${drop.F.toFixed(1)}, p = ${drop.p.toFixed(3)} — niet significant, model verandert nauwelijks zonder deze.`);
    } else if (drop.deltaR2 < 0.005) {
      lines.push(`Drop-F ${drop.F.toFixed(1)} — statistisch significant, maar ΔR² slechts ${drop.deltaR2.toFixed(4)}: praktisch verwaarloosbaar.`);
    } else {
      lines.push(`Drop-F ${drop.F.toFixed(1)} — deze variabele draagt ~${(drop.deltaR2 * 100).toFixed(2)}% R² bij. Weet je zeker dat je hem wilt verwijderen?`);
    }
  }
  return lines.join('\n');
}

export default function RegressionReport({ payload }: { payload: PainpointsPayload }) {
  const [showScatter, setShowScatter] = useState(true);
  const [selectedFeatures, setSelectedFeatures] = useState<Set<FeatureKey>>(
    () => new Set<FeatureKey>(['pop', 'area']),
  );
  const [showAdvanced, setShowAdvanced] = useState(false);

  const toggleFeature = (k: FeatureKey) =>
    setSelectedFeatures((s) => {
      const next = new Set(s);
      if (next.has(k)) {
        if (next.size > 1) next.delete(k);
      } else {
        next.add(k);
      }
      return next;
    });

  // Highlight pain-point PC4s on the scatter plot
  const scatterData = useMemo(() => {
    const scatter = payload.scatter ?? [];
    const painSet = new Set(Object.keys(payload.painpoints));
    const other = scatter.filter((p) => !painSet.has(p.pc4));
    const pain = scatter.filter((p) => painSet.has(p.pc4));
    return { other, pain };
  }, [payload.scatter, payload.painpoints]);

  // Python-fitted baseline trendline (at the mean PC4 area)
  const trendLine = useMemo(() => {
    const m = payload.model;
    if (!m || !payload.scatter || payload.scatter.length === 0) return [];
    const meanArea = payload.mean_area_km2 ?? 1;
    const maxPop = Math.max(...payload.scatter.map((p) => p.pop));
    const N = 20;
    const { intercept, coefficients } = m;
    return Array.from({ length: N }, (_, i) => {
      const pop = (maxPop * i) / (N - 1);
      const y = intercept + coefficients.population * pop + coefficients.area_km2 * meanArea;
      return { pop, actual: Math.max(0, y) };
    });
  }, [payload.model, payload.scatter, payload.mean_area_km2]);

  // Fit two models each time the feature set changes and compute advanced stats
  const modelFit = useMemo(() => {
    const scatter = payload.scatter ?? [];
    const selected = FEATURE_DEFS.filter((f) => selectedFeatures.has(f.key));
    const keys = selected.map((f) => f.key);
    const labels = selected.map((f) => f.label);

    const rows: number[][] = [];
    const ys: number[] = [];
    for (const p of scatter) {
      const vals = keys.map((k) => (p as any)[k]);
      if (vals.some((v) => v == null || typeof v !== 'number' || Number.isNaN(v))) continue;
      rows.push(vals);
      ys.push(p.actual);
    }

    if (rows.length < keys.length + 2) {
      return {
        error: `Te weinig PC4s (${rows.length}) voor ${keys.length} variabelen.`,
        keys, labels, n: rows.length,
      } as const;
    }

    try {
      const fit: ModelFit = fitModel(rows, ys, labels);
      let baseR2: number | null = null;
      try {
        const baseRows: number[][] = [];
        const baseY: number[] = [];
        for (const p of scatter) {
          if (p.pop == null || p.area == null) continue;
          const vals = keys.map((k) => (p as any)[k]);
          if (vals.some((v) => v == null || typeof v !== 'number' || Number.isNaN(v))) continue;
          baseRows.push([p.pop, p.area]);
          baseY.push(p.actual);
        }
        if (baseRows.length >= 4) baseR2 = fitModel(baseRows, baseY, ['pop', 'area']).r2;
      } catch {
        /* baseline fit optional */
      }
      const means: Record<string, number> = {};
      for (let j = 0; j < keys.length; j++) {
        let s = 0;
        for (const r of rows) s += r[j];
        means[keys[j]] = s / rows.length;
      }
      const maxPop = rows.reduce((m, r) => {
        const popIdx = keys.indexOf('pop' as FeatureKey);
        return popIdx >= 0 ? Math.max(m, r[popIdx]) : m;
      }, 0);

      const modelBic = bic(fit.ssRes, fit.n, keys.length);

      let modelVsBase: {
        r2Base: number;
        deltaR2: number;
        f2: number;
        f2Label: string;
        F: number;
        p: number;
        df1: number;
        df2: number;
      } | null = null;
      if (baseR2 != null) {
        const baseFeatures = new Set<FeatureKey>(['pop', 'area']);
        const addedCount = keys.filter((k) => !baseFeatures.has(k)).length;
        if (addedCount > 0) {
          const f2 = cohensF2(fit.r2, baseR2);
          const pf = partialF(fit.r2, baseR2, addedCount, fit.n, keys.length);
          modelVsBase = {
            r2Base: baseR2,
            deltaR2: fit.r2 - baseR2,
            f2,
            f2Label: cohensF2Label(f2),
            F: pf.F,
            p: pf.p,
            df1: pf.df1,
            df2: pf.df2,
          };
        }
      }

      const perFeatureDrop: Array<{
        key: FeatureKey;
        F: number;
        p: number;
        deltaR2: number;
      }> = [];
      if (keys.length >= 2) {
        for (let j = 0; j < keys.length; j++) {
          const otherRows = rows.map((r) => r.filter((_, idx) => idx !== j));
          try {
            const reduced = ols(otherRows, ys);
            const pf = partialF(fit.r2, reduced.r2, 1, fit.n, keys.length);
            perFeatureDrop.push({
              key: keys[j],
              F: pf.F,
              p: pf.p,
              deltaR2: fit.r2 - reduced.r2,
            });
          } catch {
            perFeatureDrop.push({ key: keys[j], F: Infinity, p: 0, deltaR2: fit.r2 });
          }
        }
      }

      return { fit, keys, labels, baseR2, means, maxPop,
               bic: modelBic, modelVsBase, perFeatureDrop } as const;
    } catch (e) {
      return {
        error: e instanceof Error ? e.message : String(e),
        keys, labels, n: rows.length,
      } as const;
    }
  }, [payload.scatter, selectedFeatures]);

  const userTrendLine = useMemo(() => {
    if ('error' in modelFit) return [];
    const { fit, keys, means, maxPop } = modelFit;
    const popIdx = keys.indexOf('pop' as FeatureKey);
    if (popIdx < 0 || maxPop <= 0) return [];
    const N = 20;
    let constPart = fit.intercept;
    for (let j = 0; j < keys.length; j++) {
      if (j === popIdx) continue;
      constPart += fit.coefficients[j] * means[keys[j]];
    }
    const betaPop = fit.coefficients[popIdx];
    return Array.from({ length: N }, (_, i) => {
      const pop = (maxPop * i) / (N - 1);
      return { pop, actual: Math.max(0, constPart + betaPop * pop) };
    });
  }, [modelFit]);

  return (
    <div className="space-y-8">
      {/* Page intro */}
      <section>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Schatting pakketpunten per PC4</h2>
        <p className="text-sm text-gray-600">
          Hoeveel pakketpunten zou er in een postcodegebied zitten op basis van bevolking, welvaart,
          stedelijkheid en voorzieningen? Deze pagina toont het Python-gefitte basismodel, een
          live-herberekenbaar maatwerkmodel, en alle statistische controles die je nodig hebt om te
          beoordelen of een variabele echt iets toevoegt.
        </p>
      </section>

      {/* Netherlands-wide regression model + scatterplot */}
      {payload.model && (
        <section className="bg-white border border-gray-200 rounded-lg p-4 md:p-5 space-y-3">
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Nederland-breed basismodel</div>
                <h3 className="text-lg font-semibold text-gray-900">Regressiemodel voor verwachte pakketpunten per PC4</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowScatter((v) => !v)}
                aria-expanded={showScatter}
                className="shrink-0 text-xs font-medium text-indigo-700 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded px-2 py-1 transition"
              >
                {showScatter ? 'Verberg grafiek' : 'Toon grafiek'}
              </button>
            </div>
            <p className="text-sm text-gray-700 leading-relaxed mt-1">
              OLS-regressie op alle {payload.model.training_size.toLocaleString('nl-NL')} Nederlandse PC4-gebieden
              (inwoners ≥ 10, oppervlakte ≥ 0,05 km²).
            </p>
            <div className="mt-2 inline-block font-mono text-sm bg-indigo-50 border border-indigo-200 text-indigo-900 rounded px-2 py-1">
              pakketpunten = {payload.model.intercept.toFixed(3)}
              {' + '}
              {payload.model.coefficients.population.toFixed(6)} × inwoners
              {' + '}
              {payload.model.coefficients.area_km2.toFixed(3)} × km²
            </div>
            <div className="mt-1 text-sm text-gray-700">
              R² = <span className="font-semibold">{payload.model.r2.toFixed(3)}</span>
              {' · '}
              ≈ +{(payload.model.coefficients.population * 1000).toFixed(2)} pakketpunten per 1 000 inwoners
              {' · '}
              +{payload.model.coefficients.area_km2.toFixed(2)} per extra km²
            </div>
            <p className="text-xs text-gray-500 mt-2 leading-relaxed">
              PC4-niveau R² is lager dan het gemeentelijke model (~0.87) — kleinere, ruisiger geografieën — maar
              geeft bruikbare verwachtingswaarden per postcode. Δ = werkelijk − voorspeld; negatieve Δ betekent
              minder pakketpunten dan op basis van inwoners en oppervlakte verwacht. Pijnpunt-PC4s zijn rood gemarkeerd.
            </p>
          </div>

          {showScatter && scatterData.other.length > 0 && (
            <div className="h-96 md:h-[28rem] -ml-2">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 10, right: 24, bottom: 64, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis
                    type="number"
                    dataKey="pop"
                    name="Inwoners"
                    domain={[0, 'dataMax']}
                    tickCount={7}
                    tickFormatter={(n) => (n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n))}
                    label={{ value: 'Inwoners per PC4', position: 'insideBottom', offset: -18, fill: '#6b7280', fontSize: 12 }}
                    tick={{ fill: '#6b7280', fontSize: 11 }}
                  />
                  <YAxis
                    type="number"
                    dataKey="actual"
                    name="Pakketpunten"
                    label={{ value: 'Pakketpunten', angle: -90, position: 'insideLeft', fill: '#6b7280', fontSize: 12 }}
                    tick={{ fill: '#6b7280', fontSize: 11 }}
                  />
                  <ZAxis range={[20, 20]} />
                  <Tooltip
                    cursor={{ strokeDasharray: '3 3' }}
                    content={({ active, payload: tp }) => {
                      if (!active || !tp || !tp.length) return null;
                      const d = tp[0].payload as ScatterPoint;
                      if (!d.pc4) {
                        return (
                          <div className="bg-white border border-gray-200 rounded shadow px-2 py-1 text-xs">
                            <div className="font-semibold text-amber-700">Trendlijn</div>
                            <div>{Math.round(d.pop).toLocaleString('nl-NL')} inw. → {d.actual.toFixed(1)} PP</div>
                          </div>
                        );
                      }
                      return (
                        <div className="bg-white border border-gray-200 rounded shadow px-2 py-1 text-xs">
                          <div className="font-semibold font-mono">PC4 {d.pc4}</div>
                          <div>{d.pop.toLocaleString('nl-NL')} inw. · {d.area.toFixed(2)} km²</div>
                          <div>Werkelijk: <span className="font-semibold">{d.actual}</span></div>
                          <div>Verwacht: {d.predicted.toFixed(1)}</div>
                        </div>
                      );
                    }}
                  />
                  <Legend
                    verticalAlign="bottom"
                    align="center"
                    iconSize={10}
                    wrapperStyle={{ fontSize: 12, paddingTop: 12, bottom: 0 }}
                  />
                  <Scatter
                    name={`PC4-gebieden (${scatterData.other.length})`}
                    data={scatterData.other}
                    fill="#6366f1"
                    fillOpacity={0.35}
                  />
                  <Scatter
                    name={`Pijnpunten (${scatterData.pain.length})`}
                    data={scatterData.pain}
                    fill="#dc2626"
                    fillOpacity={0.9}
                    shape="circle"
                  />
                  {trendLine.length > 0 && (
                    <Scatter
                      name={`Basis (pop + km²) @ ø ${payload.mean_area_km2?.toFixed(2)} km²`}
                      data={trendLine}
                      fill="#f59e0b"
                      line={{ stroke: '#f59e0b', strokeWidth: 2 }}
                      shape={() => <></>}
                      legendType="line"
                    />
                  )}
                  {userTrendLine.length > 0 && !('error' in modelFit) && (
                    <Scatter
                      name={`Jouw model (${modelFit.keys.length} var, R² ${modelFit.fit.r2.toFixed(3)})`}
                      data={userTrendLine}
                      fill="#4338ca"
                      line={{ stroke: '#4338ca', strokeWidth: 2, strokeDasharray: '6 3' }}
                      shape={() => <></>}
                      legendType="line"
                    />
                  )}
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      )}

      {/* Interactive model builder */}
      {(payload.scatter?.length ?? 0) > 0 && (
        <section className="bg-white border border-gray-200 rounded-lg p-4 md:p-5 space-y-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Zelf een model bouwen</div>
            <h3 className="text-lg font-semibold text-gray-900">Kies variabelen voor de regressie</h3>
            <p className="text-sm text-gray-700 leading-relaxed mt-1">
              Vink variabelen aan om ze aan het OLS-model toe te voegen. De fit draait live in je browser op
              alle PC4-gebieden waarvoor <em>elke</em> gekozen variabele bekend is. Gebruik de VIF-kolom om
              multicollineariteit in de gaten te houden — waardes boven 5 betekenen dat twee variabelen
              sterk op elkaar lijken.
            </p>
          </div>

          {/* Quick presets + advanced toggle */}
          <div className="flex flex-wrap items-center gap-2 text-xs bg-indigo-50/60 border border-indigo-200 rounded px-3 py-2">
            <span className="text-indigo-900 font-semibold uppercase tracking-wide">Snelkeuze</span>
            {MODEL_PRESETS.map((preset) => {
              const active =
                selectedFeatures.size === preset.keys.length
                && preset.keys.every((k) => selectedFeatures.has(k));
              return (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => setSelectedFeatures(new Set(preset.keys))}
                  title={preset.note}
                  className={`rounded px-2 py-1 font-medium transition ${
                    active
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white text-indigo-700 hover:bg-indigo-100 border border-indigo-200'
                  }`}
                >
                  {preset.name} ({preset.keys.length})
                </button>
              );
            })}
            <span className="text-indigo-900/70 ml-2">
              Voor volledige leaderboard: <code>scripts/find_best_model.py</code>
            </span>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className={`ml-auto rounded px-2 py-1 font-medium transition ${
                showAdvanced
                  ? 'bg-gray-800 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
              }`}
              aria-pressed={showAdvanced}
            >
              {showAdvanced ? '✓ Geavanceerd' : 'Geavanceerd'}
            </button>
          </div>

          {/* Feature checkboxes, grouped */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {(['basis', 'inkomen', 'ses', 'stedelijk', 'voorzieningen'] as const).map((grp) => (
              <fieldset key={grp} className="border border-gray-200 rounded p-3">
                <legend className="px-1 text-xs font-semibold text-gray-700 uppercase tracking-wide">
                  {GROUP_LABELS[grp]}
                </legend>
                <div className="space-y-1.5">
                  {FEATURE_DEFS.filter((f) => f.group === grp).map((f) => {
                    const checked = selectedFeatures.has(f.key);
                    const onlyOne = selectedFeatures.size === 1 && checked;
                    return (
                      <label
                        key={f.key}
                        className={`flex items-start gap-2 cursor-pointer rounded px-1 py-0.5 transition ${
                          checked ? 'bg-indigo-50' : 'hover:bg-gray-50'
                        } ${onlyOne ? 'opacity-80' : ''}`}
                        title={onlyOne ? 'Minstens één variabele is vereist' : f.help}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleFeature(f.key)}
                          disabled={onlyOne}
                          className="mt-0.5 w-4 h-4 text-indigo-600 rounded focus:ring-2 focus:ring-indigo-500"
                        />
                        <div className="text-sm">
                          <div className="text-gray-900">
                            {f.label}
                            {f.unit && <span className="text-gray-500 text-xs ml-1">({f.unit})</span>}
                          </div>
                          <div className="text-[11px] text-gray-500">{f.help}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>

          {/* Fit results */}
          {'error' in modelFit ? (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
              {modelFit.error}
            </div>
          ) : (
            (() => {
              const { fit, baseR2, bic: modelBic, modelVsBase, perFeatureDrop } = modelFit;
              const deltaR2 = baseR2 != null ? fit.r2 - baseR2 : null;
              const dropByKey = new Map(perFeatureDrop.map((d) => [d.key, d]));
              const featureKeyByLabel = new Map(
                FEATURE_DEFS.map((f) => [f.label, f.key] as [string, FeatureKey])
              );
              const fmtP = (p: number) =>
                p >= 0.001 ? p.toFixed(3) : p > 0 ? p.toExponential(1) : '< 1e-16';
              const canRemove = selectedFeatures.size > 1;
              return (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
                    <div>
                      <span className="text-gray-500">R² =</span>{' '}
                      <span className="font-semibold text-gray-900 tabular-nums">{fit.r2.toFixed(4)}</span>
                    </div>
                    {deltaR2 != null && (
                      <div>
                        <span className="text-gray-500">ΔR² t.o.v. basis (pop + area) =</span>{' '}
                        <span
                          className={`font-semibold tabular-nums ${
                            deltaR2 > 0.001 ? 'text-emerald-700' : deltaR2 < -0.001 ? 'text-red-700' : 'text-gray-700'
                          }`}
                        >
                          {deltaR2 >= 0 ? '+' : ''}{deltaR2.toFixed(4)}
                        </span>
                      </div>
                    )}
                    <div>
                      <span className="text-gray-500">n =</span>{' '}
                      <span className="font-semibold text-gray-900 tabular-nums">{fit.n.toLocaleString('nl-NL')}</span>
                      <span className="text-xs text-gray-500 ml-1">
                        van {payload.scatter?.length.toLocaleString('nl-NL')} PC4s
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500">intercept =</span>{' '}
                      <span className="font-semibold text-gray-900 tabular-nums">{fit.intercept.toFixed(3)}</span>
                    </div>
                    {showAdvanced && (
                      <div>
                        <span className="text-gray-500">BIC =</span>{' '}
                        <span className="font-semibold text-gray-900 tabular-nums">{modelBic.toFixed(1)}</span>
                        <span className="text-xs text-gray-500 ml-1">(lager = beter)</span>
                      </div>
                    )}
                  </div>

                  {showAdvanced && modelVsBase && (
                    <div className="bg-gray-50 border border-gray-200 rounded p-3 space-y-1 text-sm">
                      <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">
                        Model vs basis (pop + km²) op dezelfde {fit.n.toLocaleString('nl-NL')} PC4s
                      </div>
                      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                        <div>
                          <span className="text-gray-500">Cohen's f² =</span>{' '}
                          <span className="font-semibold tabular-nums">{modelVsBase.f2.toFixed(3)}</span>
                          <span className="text-xs text-gray-500 ml-1">({modelVsBase.f2Label})</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Partial F({modelVsBase.df1}, {modelVsBase.df2}) =</span>{' '}
                          <span className="font-semibold tabular-nums">{isFinite(modelVsBase.F) ? modelVsBase.F.toFixed(2) : '∞'}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">p =</span>{' '}
                          <span
                            className={`font-semibold tabular-nums ${
                              modelVsBase.p < 0.05 ? 'text-emerald-700' : 'text-gray-700'
                            }`}
                          >
                            {fmtP(modelVsBase.p)}
                          </span>
                        </div>
                      </div>
                      <p className="text-[11px] text-gray-500 mt-1">
                        f² ≥ 0.02 = klein effect, ≥ 0.15 = middel, ≥ 0.35 = groot. Bij grote <em>n</em>{' '}
                        wordt de F-toets snel "significant" — leun dus op f² om te beslissen of een
                        toevoeging <em>praktisch</em> de moeite waard is.
                      </p>
                    </div>
                  )}

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold uppercase text-xs tracking-wide text-gray-600">Variabele</th>
                          <th className="px-3 py-2 text-right font-semibold uppercase text-xs tracking-wide text-gray-600">Coëfficiënt</th>
                          <th className="px-3 py-2 text-right font-semibold uppercase text-xs tracking-wide text-gray-600">Effect per 1 eenheid</th>
                          <th className="px-3 py-2 text-right font-semibold uppercase text-xs tracking-wide text-gray-600">VIF</th>
                          {showAdvanced && (
                            <>
                              <th className="px-3 py-2 text-right font-semibold uppercase text-xs tracking-wide text-gray-600" title="F-statistiek als deze variabele wordt weggelaten (leave-one-out)">
                                Drop-F
                              </th>
                              <th className="px-3 py-2 text-right font-semibold uppercase text-xs tracking-wide text-gray-600">
                                p-waarde
                              </th>
                            </>
                          )}
                          <th className="px-3 py-2 text-center font-semibold uppercase text-xs tracking-wide text-gray-600">Actie</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {fit.featureNames.map((name, i) => {
                          const c = fit.coefficients[i];
                          const v = fit.vif[name] ?? NaN;
                          const vifColor =
                            v > 10 ? 'text-red-700' : v > 5 ? 'text-amber-700' : 'text-gray-700';
                          const fkey = featureKeyByLabel.get(name);
                          const drop = fkey ? dropByKey.get(fkey) : undefined;
                          // "Safe to remove" heuristic: VIF high OR drop not
                          // significant at α=0.05 OR ΔR² under 0.005.
                          const dropSafe = !!drop && (
                            (v > 5) || drop.p >= 0.05 || drop.deltaR2 < 0.005
                          );
                          return (
                            <tr key={name}>
                              <td className="px-3 py-2 text-gray-900">{name}</td>
                              <td className={`px-3 py-2 text-right tabular-nums font-semibold ${c >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                                {c >= 0 ? '+' : ''}{c.toExponential(3)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                                {c >= 0 ? '+' : ''}{c.toFixed(Math.abs(c) < 0.01 ? 5 : 3)} pakketpunten
                              </td>
                              <td className={`px-3 py-2 text-right tabular-nums font-semibold ${vifColor}`}>
                                {Number.isFinite(v) ? v.toFixed(2) : '∞'}
                              </td>
                              {showAdvanced && (
                                <>
                                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                                    {drop ? (isFinite(drop.F) ? drop.F.toFixed(1) : '∞') : '—'}
                                  </td>
                                  <td
                                    className={`px-3 py-2 text-right tabular-nums font-semibold ${
                                      drop && drop.p < 0.05 ? 'text-emerald-700' : 'text-gray-500'
                                    }`}
                                  >
                                    {drop ? fmtP(drop.p) : '—'}
                                  </td>
                                </>
                              )}
                              <td className="px-3 py-2 text-center">
                                <button
                                  type="button"
                                  onClick={() => fkey && toggleFeature(fkey)}
                                  disabled={!canRemove}
                                  title={fkey ? removeTooltip(name, v, drop) : 'Onbekende variabele'}
                                  aria-label={`Verwijder ${name} uit het model`}
                                  className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition ${
                                    canRemove
                                      ? dropSafe
                                        ? 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200'
                                        : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-300'
                                      : 'bg-white text-gray-300 border border-gray-200 cursor-not-allowed'
                                  }`}
                                >
                                  <span aria-hidden="true">×</span>
                                  {dropSafe ? 'Droppen' : 'Verwijder'}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <p className="text-xs text-gray-500 leading-relaxed">
                    VIF {'>'} 5: twee variabelen dragen overlappende informatie (geel). VIF {'>'} 10:
                    sterk problematisch (rood) — één van beide kan beter uit het model. De rode "Droppen"-knop
                    verschijnt automatisch wanneer een variabele statistisch niet significant is of weinig R²
                    bijdraagt; hover over de knop voor de onderbouwing.
                  </p>
                </div>
              );
            })()
          )}
        </section>
      )}
    </div>
  );
}
