// Tiny in-browser OLS + VIF. Works on up to a few thousand rows × a handful
// of features in milliseconds — that's the scale we need for PC4 regressions
// (~4 000 rows, 2–9 predictors). Heavier duty (many features, ridge, etc.)
// should move to a worker or back to Python.
//
// Numerical approach: form the normal equations X'Xβ = X'y and solve via
// Gauss-Jordan with partial pivoting. No dependency on a math library.

export interface OLSResult {
  intercept: number;
  coefficients: number[];   // ordered same as input feature columns
  r2: number;
  n: number;                // rows used (after NA filtering happens upstream)
  residuals: number[];      // y − ŷ
  yHat: number[];
  ssRes: number;            // Σ (y − ŷ)²  — kept so we can compute BIC cheaply
}

export interface ModelFit extends OLSResult {
  featureNames: string[];
  vif: Record<string, number>;
}

function solve(A: number[][], b: number[]): number[] {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(M[k][i]) > Math.abs(M[pivot][i])) pivot = k;
    }
    [M[i], M[pivot]] = [M[pivot], M[i]];
    const d = M[i][i];
    if (!isFinite(d) || Math.abs(d) < 1e-12) {
      throw new Error('Normal equations are singular — features are perfectly collinear.');
    }
    for (let j = 0; j <= n; j++) M[i][j] /= d;
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const f = M[k][i];
      if (f === 0) continue;
      for (let j = 0; j <= n; j++) M[k][j] -= f * M[i][j];
    }
  }
  return M.map((row) => row[n]);
}

export function ols(X: number[][], y: number[]): OLSResult {
  const n = X.length;
  if (n === 0) throw new Error('No rows to fit.');
  const p = X[0].length;
  // Prepend intercept column of 1s
  const X1: number[][] = X.map((row) => [1, ...row]);
  const XtX: number[][] = Array.from({ length: p + 1 }, () => Array(p + 1).fill(0));
  const Xty: number[] = Array(p + 1).fill(0);
  for (let i = 0; i < n; i++) {
    const row = X1[i];
    const yi = y[i];
    for (let j = 0; j <= p; j++) {
      Xty[j] += row[j] * yi;
      for (let k = 0; k <= p; k++) XtX[j][k] += row[j] * row[k];
    }
  }
  const beta = solve(XtX, Xty);
  const yHat = X1.map((row) => row.reduce((a, v, idx) => a + v * beta[idx], 0));
  const residuals = y.map((v, i) => v - yHat[i]);
  const yBar = y.reduce((a, v) => a + v, 0) / n;
  let ssr = 0;
  let sst = 0;
  for (let i = 0; i < n; i++) {
    ssr += residuals[i] ** 2;
    sst += (y[i] - yBar) ** 2;
  }
  const r2 = sst > 0 ? 1 - ssr / sst : 0;
  return {
    intercept: beta[0],
    coefficients: beta.slice(1),
    r2,
    n,
    residuals,
    yHat,
    ssRes: ssr,
  };
}

// Numerical helpers for the advanced stats panel. All approximations are
// more than good enough for the n ≈ 3 000 regime we operate in, where the
// F-distribution is close to its asymptotic limit anyway.
function erf(x: number): number {
  // Abramowitz & Stegun 7.1.26 — ~1.5e-7 absolute error
  const sign = Math.sign(x);
  const ax = Math.abs(x);
  const p = 0.3275911;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const t = 1 / (1 + p * ax);
  const y =
    1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

// Wilson–Hilferty transformation of F to standard normal. Accurate to
// ~4 decimals for df2 ≥ 30 and q ≥ 1 — plenty for a UI indicator.
export function fPValue(F: number, q: number, df2: number): number {
  if (!isFinite(F) || F <= 0 || q < 1 || df2 < 2) return 1;
  const a = Math.pow(F, 1 / 3);
  const term2q = 2 / (9 * q);
  const term2df = 2 / (9 * df2);
  const num = a * (1 - term2df) - (1 - term2q);
  const den = Math.sqrt(Math.pow(F, 2 / 3) * term2df + term2q);
  if (den <= 0) return 1;
  const z = num / den;
  return 1 - normalCdf(z);
}

export function bic(ssRes: number, n: number, p: number): number {
  if (ssRes <= 0 || n <= 0) return -Infinity;
  return n * Math.log(ssRes / n) + (p + 1) * Math.log(n);
}

export function cohensF2(r2Full: number, r2Reduced: number): number {
  const denom = 1 - r2Full;
  if (denom <= 0) return Infinity;
  return (r2Full - r2Reduced) / denom;
}

export function cohensF2Label(f2: number): string {
  if (f2 < 0.02) return 'verwaarloosbaar';
  if (f2 < 0.15) return 'klein';
  if (f2 < 0.35) return 'middel';
  return 'groot';
}

export interface PartialFResult {
  F: number;
  p: number;
  df1: number;
  df2: number;
}

export function partialF(
  r2Full: number,
  r2Reduced: number,
  q: number,
  n: number,
  pFull: number,
): PartialFResult {
  const df1 = q;
  const df2 = n - pFull - 1;
  if (df2 <= 0 || q <= 0 || r2Full <= r2Reduced) {
    return { F: 0, p: 1, df1, df2 };
  }
  const num = (r2Full - r2Reduced) / q;
  const den = (1 - r2Full) / df2;
  if (den <= 0) return { F: Infinity, p: 0, df1, df2 };
  const F = num / den;
  return { F, p: fPValue(F, q, df2), df1, df2 };
}

export function vif(X: number[][], names: string[]): Record<string, number> {
  const p = X[0]?.length ?? 0;
  const out: Record<string, number> = {};
  if (p <= 1) {
    if (p === 1) out[names[0]] = 1;
    return out;
  }
  for (let j = 0; j < p; j++) {
    const others = X.map((row) => row.filter((_, idx) => idx !== j));
    const target = X.map((row) => row[j]);
    try {
      const res = ols(others, target);
      out[names[j]] = res.r2 >= 0.9999 ? Infinity : 1 / (1 - res.r2);
    } catch {
      out[names[j]] = Infinity;
    }
  }
  return out;
}

export function fitModel(X: number[][], y: number[], names: string[]): ModelFit {
  const res = ols(X, y);
  return { ...res, featureNames: names, vif: vif(X, names) };
}
