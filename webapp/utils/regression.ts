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
  };
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
