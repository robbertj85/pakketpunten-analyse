"""Fit a linear regression predicting parcel points from PC4 features.

Base model::

    parcel_points = α + β₁ · population + β₂ · area_km2

Extended model (when CBS income + SES-WOA data are available)::

    parcel_points = α + β₁·population + β₂·area_km2 + β₃·income + β₄·ses_woa

Both models are trained on the subset of PC4s with population ≥ 10 and
area ≥ 0.05 km². The extended model additionally requires non-missing
income and SES-WOA values (CBS suppresses these for small PC4s).

The script writes two sets of predictions back to ``pc4_stats.json``:
  - ``predicted_points``       → from the base model (full 4 071 PC4 coverage)
  - ``predicted_points_ext``   → from the extended model (≈ 80 % coverage)
  - ``delta_vs_predicted``     → base residual
  - ``delta_vs_predicted_ext`` → extended residual

Multicollinearity is reported via Variance Inflation Factors so downstream
readers can judge whether income and SES-WOA truly add information beyond
population and area, or just duplicate it.
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

EXTENDED_FEATURES = [
    "population",
    "area_km2",
    "avg_income_household",
    "ses_woa_total",
]
BASE_FEATURES = ["population", "area_km2"]
# Best-subset k=8 winner from `scripts/find_best_model.py` (recommendation
# block in output/best_model_report.json). R² ≈ 0.539 vs 0.439 for the base
# model — meaningful uplift, surfaced as an alternative regression in the
# placement-advice page.
K8_FEATURES = [
    "population",
    "avg_woz_value",
    "oad",
    "horeca_1km",
    "supermarket_1km",
    "ov_stops",
    "crashes_freight",
    "crashes_freight_vs_vulnerable",
]


def compute_vif(df: pd.DataFrame, features: list[str]) -> dict[str, float]:
    """Variance inflation factors via 1 / (1 − R²) of each feature regressed
    on the others. VIF > 5 is a yellow flag, > 10 red (textbook thresholds).
    Computed ourselves to avoid a statsmodels dependency.
    """
    vifs: dict[str, float] = {}
    for i, target in enumerate(features):
        others = [f for j, f in enumerate(features) if j != i]
        X = df[others].to_numpy()
        y = df[target].to_numpy()
        if np.var(y) == 0:
            vifs[target] = float("inf")
            continue
        m = LinearRegression().fit(X, y)
        r2 = m.score(X, y)
        vifs[target] = float("inf") if r2 >= 0.9999 else round(1 / (1 - r2), 2)
    return vifs


def main() -> int:
    with open(STATS_PATH) as f:
        payload = json.load(f)
    stats: dict[str, dict] = payload["stats"]

    rows = []
    for pc4, v in stats.items():
        row = {
            "pc4": pc4,
            "population": v["population"],
            "area_km2": v["area_km2"],
            "parcel_points": v["parcel_points"]["total"],
            "avg_income_household": v.get("avg_income_household"),
            "ses_woa_total": v.get("ses_woa_total"),
        }
        # Pick up every K8 feature too — they're already in pc4_stats.json.
        for f in K8_FEATURES:
            row.setdefault(f, v.get(f))
        rows.append(row)
    df = pd.DataFrame(rows)
    print(f"Loaded {len(df)} PC4 rows")

    # ---- Base model: population + area_km2 ----
    base_mask = (df["population"] >= MIN_POPULATION) & (df["area_km2"] >= MIN_AREA_KM2)
    train = df[base_mask].copy()
    print(f"\n[BASE] Training on {len(train)} PC4s "
          f"(dropped {len(df) - len(train)} below pop/area thresholds)")

    X = train[BASE_FEATURES].to_numpy()
    y = train["parcel_points"].to_numpy()
    base_model = LinearRegression()
    base_model.fit(X, y)
    r2_base = base_model.score(X, y)

    print(f"R²             = {r2_base:.4f}")
    print(f"Intercept (α)  = {base_model.intercept_:.4f}")
    print(f"β_population   = {base_model.coef_[0]:.6f}  → "
          f"+{base_model.coef_[0] * 1000:.3f} points per 1000 inhabitants")
    print(f"β_area_km2     = {base_model.coef_[1]:.4f}  → "
          f"+{base_model.coef_[1]:.3f} points per km²")
    vif_base = compute_vif(train, BASE_FEATURES)
    print(f"VIF            = {vif_base}")

    # Apply base predictions to every PC4 (fill NaN inputs with 0 so predict
    # doesn't blow up on PC4s missing population).
    X_all = df[BASE_FEATURES].fillna(0).to_numpy()
    df["predicted"] = np.clip(base_model.predict(X_all), 0, None).round(2)

    # ---- Extended model: population + area_km2 + income + SES-WOA ----
    ext_mask = (
        base_mask
        & df["avg_income_household"].notna()
        & df["ses_woa_total"].notna()
    )
    ext_available = ext_mask.sum()
    ext_model = None
    r2_ext = None
    vif_ext = None
    if ext_available >= 100:
        train_ext = df[ext_mask].copy()
        print(f"\n[EXTENDED] Training on {len(train_ext)} PC4s "
              f"(dropped {len(df) - len(train_ext)} below thresholds or with "
              f"missing income/SES-WOA)")

        X_ext = train_ext[EXTENDED_FEATURES].to_numpy()
        y_ext = train_ext["parcel_points"].to_numpy()
        ext_model = LinearRegression()
        ext_model.fit(X_ext, y_ext)
        r2_ext = ext_model.score(X_ext, y_ext)

        print(f"R²             = {r2_ext:.4f}  (ΔR² vs base: "
              f"{r2_ext - r2_base:+.4f})")
        print(f"Intercept (α)  = {ext_model.intercept_:.4f}")
        for name, coef in zip(EXTENDED_FEATURES, ext_model.coef_):
            print(f"β_{name:<22} = {coef:+.6f}")
        vif_ext = compute_vif(train_ext, EXTENDED_FEATURES)
        print(f"VIF            = {vif_ext}")
        _flag_high_vif(vif_ext)

        # Predict for PC4s where all four features are present
        predictable = (
            df["population"].notna() & df["area_km2"].notna()
            & df["avg_income_household"].notna() & df["ses_woa_total"].notna()
        )
        df["predicted_ext"] = np.nan
        if predictable.any():
            X_ext_all = df.loc[predictable, EXTENDED_FEATURES].to_numpy()
            df.loc[predictable, "predicted_ext"] = np.clip(
                ext_model.predict(X_ext_all), 0, None
            ).round(2)
    else:
        print(f"\n[EXTENDED] Skipped — only {ext_available} PC4s have both "
              f"income and SES-WOA (need ≥ 100).")

    # ---- K=8 best-subset model (from find_best_model.py) ----
    k8_mask = base_mask
    for f in K8_FEATURES:
        k8_mask = k8_mask & df[f].notna()
    k8_available = k8_mask.sum()
    k8_model = None
    r2_k8 = None
    vif_k8 = None
    if k8_available >= 100:
        train_k8 = df[k8_mask].copy()
        print(f"\n[K=8] Training on {len(train_k8)} PC4s "
              f"(dropped {len(df) - len(train_k8)} below thresholds or with "
              f"missing K8 features)")
        X_k8 = train_k8[K8_FEATURES].to_numpy()
        y_k8 = train_k8["parcel_points"].to_numpy()
        k8_model = LinearRegression()
        k8_model.fit(X_k8, y_k8)
        r2_k8 = k8_model.score(X_k8, y_k8)
        print(f"R²             = {r2_k8:.4f}  (ΔR² vs base: "
              f"{r2_k8 - r2_base:+.4f})")
        print(f"Intercept (α)  = {k8_model.intercept_:.4f}")
        for name, coef in zip(K8_FEATURES, k8_model.coef_):
            print(f"β_{name:<32} = {coef:+.6f}")
        vif_k8 = compute_vif(train_k8, K8_FEATURES)
        print(f"VIF            = {vif_k8}")
        _flag_high_vif(vif_k8)

        # Predict for PC4s where all 8 K8 features are non-null.
        predictable_k8 = pd.Series(True, index=df.index)
        for f in K8_FEATURES:
            predictable_k8 = predictable_k8 & df[f].notna()
        df["predicted_k8"] = np.nan
        if predictable_k8.any():
            X_k8_all = df.loc[predictable_k8, K8_FEATURES].to_numpy()
            df.loc[predictable_k8, "predicted_k8"] = np.clip(
                k8_model.predict(X_k8_all), 0, None
            ).round(2)
    else:
        print(f"\n[K=8] Skipped — only {k8_available} PC4s have all eight K8 features.")

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
        v["points_per_km2"] = round(total / area, 3) if area > 0 else None
        v["points_per_1000_inw"] = round(total / pop * 1000, 3) if pop > 0 else None
        v["predicted_points"] = predicted
        v["delta_vs_predicted"] = round(total - predicted, 2)
        pred_ext = row.get("predicted_ext")
        if pred_ext is not None and not pd.isna(pred_ext):
            v["predicted_points_ext"] = float(pred_ext)
            v["delta_vs_predicted_ext"] = round(total - float(pred_ext), 2)
        else:
            v["predicted_points_ext"] = None
            v["delta_vs_predicted_ext"] = None
        pred_k8 = row.get("predicted_k8")
        if pred_k8 is not None and not pd.isna(pred_k8):
            v["predicted_points_k8"] = float(pred_k8)
            v["delta_vs_predicted_k8"] = round(total - float(pred_k8), 2)
        else:
            v["predicted_points_k8"] = None
            v["delta_vs_predicted_k8"] = None
        # Simple-rate alternative: 50/50 convex combination of the per-capita
        # and per-km2 expectations. Each rate alone already distributes the
        # full national total, so summing both would double-count; the 0.5
        # weights keep the nationwide sum equal to the national total.
        v["expected_simple_rate"] = round(
            0.5 * rate_per_cap * pop + 0.5 * rate_per_km2 * area, 2
        ) if pop or area else 0.0

    payload["model"] = {
        "type": "OLS",
        "features": BASE_FEATURES,
        "target": "parcel_points",
        "r2": round(r2_base, 4),
        "intercept": float(base_model.intercept_),
        "coefficients": {
            "population": float(base_model.coef_[0]),
            "area_km2": float(base_model.coef_[1]),
        },
        "vif": vif_base,
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
    if ext_model is not None:
        payload["model_ext"] = {
            "type": "OLS",
            "features": EXTENDED_FEATURES,
            "target": "parcel_points",
            "r2": round(r2_ext, 4),
            "delta_r2_vs_base": round(r2_ext - r2_base, 4),
            "intercept": float(ext_model.intercept_),
            "coefficients": {
                name: float(coef)
                for name, coef in zip(EXTENDED_FEATURES, ext_model.coef_)
            },
            "vif": vif_ext,
            "training_size": int(ext_mask.sum()),
            "coverage_pct": round(100 * ext_mask.sum() / base_mask.sum(), 1),
        }
    else:
        payload["model_ext"] = None
    if k8_model is not None:
        payload["model_k8"] = {
            "type": "OLS",
            "features": K8_FEATURES,
            "target": "parcel_points",
            "r2": round(r2_k8, 4),
            "delta_r2_vs_base": round(r2_k8 - r2_base, 4),
            "intercept": float(k8_model.intercept_),
            "coefficients": {
                name: float(coef)
                for name, coef in zip(K8_FEATURES, k8_model.coef_)
            },
            "vif": vif_k8,
            "training_size": int(k8_mask.sum()),
            "coverage_pct": round(100 * k8_mask.sum() / base_mask.sum(), 1),
            "source": "scripts/find_best_model.py best-subset (k=8)",
        }
    else:
        payload["model_k8"] = None
    payload["stats"] = stats

    with open(STATS_PATH, "w") as f:
        json.dump(payload, f, separators=(",", ":"), allow_nan=False)
    print(f"\n✓ Wrote predictions + model metadata → {STATS_PATH}")
    return 0


def _flag_high_vif(vifs: dict[str, float]) -> None:
    hits = [(k, v) for k, v in vifs.items() if v > 5]
    if hits:
        print("  ⚠  Elevated VIF — features share variance:")
        for k, v in hits:
            level = "RED" if v > 10 else "yellow"
            print(f"     {k}: {v} ({level})")


if __name__ == "__main__":
    sys.exit(main())
