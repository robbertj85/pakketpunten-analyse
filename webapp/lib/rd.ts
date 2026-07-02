// Approximate conversion between WGS84 (EPSG:4326) and RD New (EPSG:28992).
//
// Uses the well-known polynomial approximation by Schreutelkamp & Strang van
// Hees ("Benaderingsformules voor de transformatie tussen RD- en WGS84-
// coordinaten"). Accurate to roughly a few centimetres across the Netherlands —
// more than enough to anchor a 3-metre parcel locker against a building.

const X0 = 155000;
const Y0 = 463000;
const PHI0 = 52.15517440;
const LAM0 = 5.38720621;

export interface RdPoint {
  x: number;
  y: number;
}

/** WGS84 lat/lon (degrees) -> RD New x/y (metres). */
export function wgs84ToRd(lat: number, lon: number): RdPoint {
  const dPhi = 0.36 * (lat - PHI0);
  const dLam = 0.36 * (lon - LAM0);

  const R: [number, number, number][] = [
    [0, 1, 190094.945],
    [1, 1, -11832.228],
    [2, 1, -114.221],
    [0, 3, -32.391],
    [1, 0, -0.705],
    [3, 1, -2.34],
    [1, 3, -0.608],
    [0, 2, -0.008],
    [2, 3, 0.148],
  ];
  const S: [number, number, number][] = [
    [1, 0, 309056.544],
    [0, 2, 3638.893],
    [2, 0, 73.077],
    [1, 2, -157.984],
    [3, 0, 59.788],
    [0, 1, 0.433],
    [2, 2, -6.439],
    [1, 1, -0.032],
    [0, 4, 0.092],
    [1, 4, -0.054],
  ];

  let x = X0;
  for (const [p, q, c] of R) {
    x += c * Math.pow(dPhi, p) * Math.pow(dLam, q);
  }
  let y = Y0;
  for (const [p, q, c] of S) {
    y += c * Math.pow(dPhi, p) * Math.pow(dLam, q);
  }
  return { x, y };
}

/** RD New x/y (metres) -> WGS84 lat/lon (degrees). */
export function rdToWgs84(x: number, y: number): { lat: number; lon: number } {
  const dX = (x - X0) * 1e-5;
  const dY = (y - Y0) * 1e-5;

  const K: [number, number, number][] = [
    [0, 1, 3235.65389],
    [2, 0, -32.58297],
    [0, 2, -0.2475],
    [2, 1, -0.84978],
    [0, 3, -0.0655],
    [2, 2, -0.01709],
    [1, 0, -0.00738],
    [4, 0, 0.0053],
    [2, 3, -0.00039],
    [4, 1, 0.00033],
    [1, 1, -0.00012],
  ];
  const L: [number, number, number][] = [
    [1, 0, 5260.52916],
    [1, 1, 105.94684],
    [1, 2, 2.45656],
    [3, 0, -0.81885],
    [1, 3, 0.05594],
    [3, 1, -0.05607],
    [0, 1, 0.01199],
    [3, 2, -0.00256],
    [1, 4, 0.00128],
    [0, 2, 0.00022],
    [2, 0, -0.00022],
    [5, 0, 0.00026],
  ];

  let phi = PHI0;
  for (const [p, q, c] of K) {
    phi += (c * Math.pow(dX, p) * Math.pow(dY, q)) / 3600;
  }
  let lam = LAM0;
  for (const [p, q, c] of L) {
    lam += (c * Math.pow(dX, p) * Math.pow(dY, q)) / 3600;
  }
  return { lat: phi, lon: lam };
}
