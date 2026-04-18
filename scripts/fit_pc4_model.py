"""Fit a linear regression predicting parcel points from population and area.

Reads ``pc4_stats.json``, fits::

    parcel_points = α + β₁ · population + β₂ · area_km2

using OLS on the subset of PC4s with population > 0 and at least some
built-up area. Writes back the same file with ``predicted_points`` and a
``model`` metadata block. Also attaches per-PC4 density metrics
(``points_per_km2``, ``points_per_1000_inw``) for direct UI use.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression

ROOT = Path(__file__).parent.parent
STATS_PATH = ROOT / "webapp" / "public" / "data" / "pc4_stats.json"

# Minimum thresholds for inclusion in the training set
MIN_POPULATION = 10        # avoid empty/industrial PC4s
MIN_AREA_KM2 = 0.05        # avoid degenerate polygons


def main() -> int:
    with open(STATS_PATH) as f:
        payload = json.load(f)
    stats: dict[str, dict] = payload["stats"]

    rows = []
    for pc4, v in stats.items():
        rows.append({
            "pc4": pc4,
            "population": v["population"],
            "area_km2": v["area_km2"],
            "parcel_points": v["parcel_points"]["total"],
        })
    df = pd.DataFrame(rows)
    print(f"Loaded {len(df)} PC4 rows")

    mask = (df["population"] >= MIN_POPULATION) & (df["area_km2"] >= MIN_AREA_KM2)
    train = df[mask].copy()
    print(f"Training on {len(train)} PC4s "
          f"(dropped {len(df) - len(train)} below pop/area thresholds)")

    X = train[["population", "area_km2"]].to_numpy()
    y = train["parcel_points"].to_numpy()
    model = LinearRegression()
    model.fit(X, y)
    r2 = model.score(X, y)

    print(f"R²             = {r2:.4f}")
    print(f"Intercept (α)  = {model.intercept_:.4f}")
    print(f"β_population   = {model.coef_[0]:.6f}  → "
          f"+{model.coef_[0] * 1000:.3f} points per 1000 inhabitants")
    print(f"β_area_km2     = {model.coef_[1]:.4f}  → "
          f"+{model.coef_[1]:.3f} points per km²")

    # Apply predictions to every PC4 (including those excluded from training).
    # Fill missing inputs with 0 so the predict call doesn't choke.
    X_all = df[["population", "area_km2"]].fillna(0).to_numpy()
    df["predicted"] = np.clip(model.predict(X_all), 0, None).round(2)

    # Simple nationwide rates as an alternative sanity-check
    tot_pts = df["parcel_points"].sum()
    tot_pop = df["population"].sum()
    tot_area = df["area_km2"].sum()
    rate_per_cap = tot_pts / tot_pop if tot_pop else 0
    rate_per_km2 = tot_pts / tot_area if tot_area else 0

    for pc4, v in stats.items():
        row = df[df["pc4"] == pc4].iloc[0]
        total = v["parcel_points"]["total"]
        area = v["area_km2"]
        pop = v["population"]
        predicted = float(row["predicted"])
        delta = total - predicted
        v["points_per_km2"] = round(total / area, 3) if area > 0 else None
        v["points_per_1000_inw"] = round(total / pop * 1000, 3) if pop > 0 else None
        v["predicted_points"] = predicted
        v["delta_vs_predicted"] = round(delta, 2)
        # Simple-rate alternative: what the nationwide ratio would yield
        v["expected_simple_rate"] = round(
            rate_per_cap * pop + rate_per_km2 * area, 2
        ) if pop or area else 0.0

    payload["model"] = {
        "type": "OLS",
        "features": ["population", "area_km2"],
        "target": "parcel_points",
        "r2": round(r2, 4),
        "intercept": float(model.intercept_),
        "coefficients": {
            "population": float(model.coef_[0]),
            "area_km2": float(model.coef_[1]),
        },
        "training_size": int(len(train)),
        "training_filters": {
            "min_population": MIN_POPULATION,
            "min_area_km2": MIN_AREA_KM2,
        },
        "nationwide_rates": {
            "points_per_inhabitant": round(rate_per_cap, 6),
            "points_per_km2": round(rate_per_km2, 4),
        },
    }
    payload["stats"] = stats

    with open(STATS_PATH, "w") as f:
        json.dump(payload, f, separators=(",", ":"), allow_nan=False)
    print(f"✓ Wrote predictions + model metadata → {STATS_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
