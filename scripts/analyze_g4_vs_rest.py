"""Fit the 'Beste k=6' parcel-point model separately for Amsterdam,
Rotterdam, Utrecht, Den Haag, and 'rest of NL', and export coefficient
comparisons as both JSON and a matplotlib figure.

This answers: do the G4 cities behave like the nationwide model, or do
they each have their own patterns? The output feeds the municipal
action-report PDF.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

ROOT = Path(__file__).parent.parent
STATS_PATH = ROOT / "webapp" / "public" / "data" / "pc4_stats.json"
OUTPUT_DIR = ROOT / "output" / "handelingsperspectief"

# The elbow + BIC winner from scripts/find_best_model.py
FEATURE_KEYS = [
    "population",
    "pct_low_income_household",
    "oad",
    "horeca_1km",
    "supermarket_1km",
    "ov_stops",
]
FEATURE_LABELS = {
    "population":              "Inwoners",
    "pct_low_income_household": "% laag inkomen",
    "oad":                     "OAD",
    "horeca_1km":              "Horeca 1km",
    "supermarket_1km":         "Supermarkten 1km",
    "ov_stops":                "OV-haltes",
}
# G4 municipality names as stored in pc4_stats.json
G4 = {
    "Amsterdam": "Amsterdam",
    "Rotterdam": "Rotterdam",
    "Utrecht":   "Utrecht",
    "Den Haag":  "Den Haag",
}
MIN_POPULATION = 10
MIN_AREA_KM2 = 0.05


def fit_subset(rows: list[dict]) -> dict:
    if len(rows) < len(FEATURE_KEYS) + 5:
        return {"error": f"too few rows: {len(rows)}"}
    X = np.array([[r[k] for k in FEATURE_KEYS] for r in rows], dtype=float)
    y = np.array([r["y"] for r in rows], dtype=float)
    X1 = np.hstack([np.ones((len(rows), 1)), X])
    beta, *_ = np.linalg.lstsq(X1, y, rcond=None)
    y_hat = X1 @ beta
    ss_res = float(np.sum((y - y_hat) ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
    return {
        "n": len(rows),
        "r2": round(r2, 4),
        "intercept": float(beta[0]),
        "coefficients": {FEATURE_KEYS[i]: float(beta[i + 1]) for i in range(len(FEATURE_KEYS))},
        "mean_parcel_points": float(y.mean()),
    }


def load_rows() -> tuple[dict[str, list[dict]], list[dict]]:
    with open(STATS_PATH) as f:
        stats = json.load(f)["stats"]
    buckets: dict[str, list[dict]] = {name: [] for name in G4}
    rest: list[dict] = []
    for pc4, v in stats.items():
        if v.get("area_km2", 0) < MIN_AREA_KM2 or (v.get("population") or 0) < MIN_POPULATION:
            continue
        if any(v.get(k) is None for k in FEATURE_KEYS):
            continue
        row = {k: float(v[k]) for k in FEATURE_KEYS}
        row["y"] = float(v["parcel_points"]["total"])
        munic = v.get("municipality")
        placed = False
        for name, munic_name in G4.items():
            if munic == munic_name:
                buckets[name].append(row)
                placed = True
                break
        if not placed:
            rest.append(row)
    return buckets, rest


def plot_coefficients(fits: dict[str, dict], outfile: Path) -> None:
    """Grouped bar chart: one bar group per feature, one bar per region."""
    regions = list(fits.keys())
    colors = {"Amsterdam": "#dc2626", "Rotterdam": "#16a34a",
              "Utrecht": "#2563eb", "Den Haag": "#a855f7",
              "Rest van NL": "#6b7280"}
    fig, axes = plt.subplots(2, 3, figsize=(12, 6.5))
    axes = axes.flatten()
    for i, key in enumerate(FEATURE_KEYS):
        ax = axes[i]
        vals = []
        names = []
        cols = []
        for region in regions:
            coef = fits[region].get("coefficients", {}).get(key)
            if coef is None:
                continue
            vals.append(coef)
            names.append(region)
            cols.append(colors.get(region, "#6b7280"))
        bars = ax.bar(names, vals, color=cols, edgecolor="white", linewidth=0.8)
        ax.axhline(0, color="#888", linewidth=0.6)
        ax.set_title(FEATURE_LABELS[key], fontsize=11, fontweight="bold")
        ax.tick_params(axis="x", labelrotation=30, labelsize=8)
        ax.grid(axis="y", color="#eee", zorder=0)
        # Annotate with the value; scientific notation where coefficients are tiny
        for bar, val in zip(bars, vals):
            txt = f"{val:+.2e}" if abs(val) < 0.01 else f"{val:+.2f}"
            ax.text(bar.get_x() + bar.get_width() / 2, val,
                    txt, ha="center",
                    va="bottom" if val >= 0 else "top",
                    fontsize=7)
    fig.suptitle("Regressie-coëfficiënten per stad (model Beste-k=6)",
                 fontsize=13, fontweight="bold")
    fig.tight_layout()
    fig.savefig(outfile, dpi=180)
    plt.close(fig)


def plot_r2_comparison(fits: dict[str, dict], outfile: Path) -> None:
    regions = list(fits.keys())
    r2s = [fits[r].get("r2", 0) for r in regions]
    ns = [fits[r].get("n", 0) for r in regions]
    colors = ["#dc2626", "#16a34a", "#2563eb", "#a855f7", "#6b7280"]
    fig, ax = plt.subplots(figsize=(8, 4))
    bars = ax.bar(regions, r2s, color=colors, edgecolor="white", linewidth=1)
    for bar, r2, n in zip(bars, r2s, ns):
        ax.text(bar.get_x() + bar.get_width() / 2, r2,
                f"R²={r2:.3f}\nn={n}",
                ha="center", va="bottom", fontsize=9)
    ax.set_ylim(0, max(r2s) * 1.25 if r2s else 1)
    ax.set_ylabel("R² (verklaarde variantie)")
    ax.set_title("Modelfit per regio", fontsize=12, fontweight="bold")
    ax.grid(axis="y", color="#eee")
    fig.tight_layout()
    fig.savefig(outfile, dpi=180)
    plt.close(fig)


def main() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    buckets, rest = load_rows()
    fits: dict[str, dict] = {}
    for city, rows in buckets.items():
        print(f"{city:<12} n={len(rows)}")
        fits[city] = fit_subset(rows)
    print(f"{'Rest van NL':<12} n={len(rest)}")
    fits["Rest van NL"] = fit_subset(rest)

    # Header
    print()
    print(f"{'Regio':<14}{'n':>6}{'R²':>8}  " + "  ".join(
        f"{FEATURE_LABELS[k][:10]:>12}" for k in FEATURE_KEYS
    ))
    for region, fit in fits.items():
        if "error" in fit:
            continue
        coefs = fit["coefficients"]
        print(
            f"{region:<14}{fit['n']:>6}{fit['r2']:>8.3f}  "
            + "  ".join(
                f"{coefs[k]:>12.3e}" if abs(coefs[k]) < 0.01 else f"{coefs[k]:>12.3f}"
                for k in FEATURE_KEYS
            )
        )

    (OUTPUT_DIR / "g4_analysis.json").write_text(
        json.dumps({"fits": fits, "features": FEATURE_KEYS,
                    "labels": FEATURE_LABELS}, indent=2, allow_nan=False)
    )
    plot_coefficients(fits, OUTPUT_DIR / "coefficients_per_region.png")
    plot_r2_comparison(fits, OUTPUT_DIR / "r2_per_region.png")
    print(f"\n✓ Output → {OUTPUT_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
