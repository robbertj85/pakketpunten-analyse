"""Exhaustive best-subset OLS search for the PC4 parcel-point regression.

Runs OLS on *every* non-empty subset of candidate features (up to a size
cap) and ranks the fits by three standard criteria:

  - R²          (always increases with more features — diagnostic only)
  - Adjusted R² (penalizes model complexity a little)
  - BIC         (penalizes complexity hard, favours sparse models)

For each subset size k it prints the best model. It then recommends a
*parsimonious* model using an elbow rule on R²: pick the smallest k where
adding another feature gains less than ELBOW_DELTA_R2 (default 0.003).
That approximates "smallest model that's within statistical noise of the
best bigger model".

All candidate features must be non-null on the same set of PC4s — the
script enforces complete-case filtering before the search so every
candidate subset is compared on identical data. Rows below the training
thresholds (population ≥ 10, area ≥ 0.05 km²) are excluded.

Usage:

    source venv/bin/activate
    python scripts/find_best_model.py [--max-k N] [--elbow D]

Output: a plain-text report, plus ``output/best_model_report.json`` with
the full ranked leaderboard for each k.
"""
from __future__ import annotations

import argparse
import itertools
import json
import math
import sys
import time
from pathlib import Path

import numpy as np
from scipy import stats as sp_stats

ROOT = Path(__file__).parent.parent
STATS_PATH = ROOT / "webapp" / "public" / "data" / "pc4_stats.json"
OUTPUT_DIR = ROOT / "output"
REPORT_JSON = OUTPUT_DIR / "best_model_report.json"
REPORT_TXT = OUTPUT_DIR / "best_model_report.txt"

MIN_POPULATION = 10
MIN_AREA_KM2 = 0.05

# All candidate features. Order is irrelevant to the algorithm but we group
# them here so the report is easier to read.
CANDIDATE_FEATURES: list[tuple[str, str]] = [
    # (key in pc4_stats.json, human-friendly label)
    ("population", "Inwoners"),
    ("area_km2", "Oppervlakte (km²)"),
    ("avg_income_household", "Gem. besteedbaar inkomen / hh"),
    ("pct_low_income_household", "% huishoudens laag inkomen"),
    ("pct_high_income_household", "% huishoudens hoog inkomen"),
    ("avg_woz_value", "Gem. WOZ-waarde"),
    ("ses_woa_total", "SES-WOA totaalscore"),
    ("ses_woa_welvaart", "SES-WOA welvaart"),
    ("ses_woa_arbeid", "SES-WOA arbeidsverleden"),
    ("urbanity", "Stedelijkheid (1-5)"),
    ("oad", "Omgevingsadressendichtheid"),
    ("pct_age_25_45", "% inwoners 25-45 jaar"),
    ("pct_single_hh", "% eenpersoonshuishoudens"),
    ("pct_multi_family", "% meergezinswoningen"),
    ("pct_owner_occupied", "% koopwoningen"),
    ("horeca_1km", "Horeca binnen 1 km"),
    ("supermarket_1km", "Supermarkten binnen 1 km"),
    ("station_km", "Afstand treinstation (km)"),
    ("highway_km", "Afstand snelwegoprit (km)"),
    ("loading_zones", "Laad-/losplaatsen (NDW E7)"),
    ("loading_zones_per_km2", "Laad-/losplaatsen per km²"),
    ("in_emission_zone", "In milieu-/ZE-zone (0/1)"),
    ("ov_stops", "OV-haltes (GTFS)"),
    ("ov_stops_per_km2", "OV-haltes per km²"),
    ("ov_train_stops", "Trein-achtige halten"),
]


def fit_ols(X: np.ndarray, y: np.ndarray) -> tuple[float, float, float]:
    """Return (R², residual sum of squares, intercept included).

    X is n × p without the intercept column — we prepend it inside. Solves
    via numpy.linalg.lstsq which is a single LAPACK call; ~0.1 ms per fit
    on this dataset. No need for sklearn overhead when we run 2¹⁹ fits.
    """
    n = X.shape[0]
    X1 = np.hstack([np.ones((n, 1)), X])
    beta, *_ = np.linalg.lstsq(X1, y, rcond=None)
    y_hat = X1 @ beta
    ss_res = float(np.sum((y - y_hat) ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
    return r2, ss_res, float(beta[0])


def adjusted_r2(r2: float, n: int, p: int) -> float:
    if n - p - 1 <= 0:
        return float("-inf")
    return 1 - (1 - r2) * (n - 1) / (n - p - 1)


def bic(ss_res: float, n: int, p: int) -> float:
    # Gaussian-OLS BIC: n·ln(SSR/n) + (p+1)·ln(n). Lower is better.
    if ss_res <= 0 or n <= 0:
        return float("-inf")
    return n * math.log(ss_res / n) + (p + 1) * math.log(n)


def partial_f_test(r2_full: float, r2_reduced: float, q: int, n: int,
                   p_full: int) -> tuple[float, float]:
    """Partial-F test for H0: the q extra variables add nothing.

    Returns (F, p-value). Requires the reduced model to be strictly nested
    inside the full model — caller must check. For non-nested comparisons
    use Cohen's f² + ΔBIC instead (neither requires nesting).
    """
    df2 = n - p_full - 1
    if df2 <= 0 or q <= 0 or r2_full <= r2_reduced:
        return 0.0, 1.0
    num = (r2_full - r2_reduced) / q
    den = (1 - r2_full) / df2
    if den <= 0:
        return float("inf"), 0.0
    F = num / den
    p = float(sp_stats.f.sf(F, q, df2))
    return F, p


def cohens_f2(r2_full: float, r2_reduced: float) -> float:
    """Cohen's f² effect size for the contribution of the extra variables.
    Rules of thumb: ≥ 0.02 small, ≥ 0.15 medium, ≥ 0.35 large. Unlike the
    F-statistic this does not grow with sample size.
    """
    denom = 1 - r2_full
    if denom <= 0:
        return float("inf")
    return (r2_full - r2_reduced) / denom


def effect_label(f2: float) -> str:
    if f2 < 0.02:
        return "verwaarloosbaar"
    if f2 < 0.15:
        return "klein"
    if f2 < 0.35:
        return "middel"
    return "groot"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--max-k", type=int, default=8,
                        help="Maximum subset size to enumerate (default 8).")
    parser.add_argument("--elbow", type=float, default=0.003,
                        help="Elbow threshold on R² gain (default 0.003).")
    parser.add_argument("--top", type=int, default=5,
                        help="Top N models to keep per size (default 5).")
    args = parser.parse_args()

    with open(STATS_PATH) as f:
        payload = json.load(f)
    stats: dict[str, dict] = payload["stats"]

    # Build the full feature matrix. Keep only PC4s above thresholds AND
    # with every candidate feature present. This makes the combinatorial
    # search comparable — every subset scores on the same rows.
    feature_keys = [k for k, _ in CANDIDATE_FEATURES]
    feature_labels = {k: lbl for k, lbl in CANDIDATE_FEATURES}

    rows: list[dict] = []
    for pc4, v in stats.items():
        if v["area_km2"] < MIN_AREA_KM2:
            continue
        if (v.get("population") or 0) < MIN_POPULATION:
            continue
        if any(v.get(k) is None for k in feature_keys):
            continue
        try:
            row = {k: float(v[k]) for k in feature_keys}
        except (TypeError, ValueError):
            continue
        row["y"] = float(v["parcel_points"]["total"])
        row["pc4"] = pc4
        rows.append(row)

    n = len(rows)
    if n < 50:
        print(f"Only {n} complete-case PC4s — aborting.", file=sys.stderr)
        return 1

    X_full = np.array([[r[k] for k in feature_keys] for r in rows], dtype=float)
    y = np.array([r["y"] for r in rows], dtype=float)
    total_subsets = sum(math.comb(len(feature_keys), k)
                        for k in range(1, args.max_k + 1))
    print(f"Complete-case rows: {n}")
    print(f"Candidate features: {len(feature_keys)}")
    print(f"Enumerating {total_subsets:,} subsets up to size {args.max_k}...\n")

    start = time.time()
    best_per_k: dict[int, list[dict]] = {}

    for k in range(1, args.max_k + 1):
        leaderboard: list[tuple[float, tuple[int, ...], float, float]] = []
        for combo in itertools.combinations(range(len(feature_keys)), k):
            X = X_full[:, list(combo)]
            r2, ss_res, _ = fit_ols(X, y)
            ar2 = adjusted_r2(r2, n, k)
            b = bic(ss_res, n, k)
            leaderboard.append((r2, combo, ar2, b))
        leaderboard.sort(reverse=True, key=lambda t: t[0])
        top = leaderboard[: args.top]
        best_per_k[k] = [
            {
                "features": [feature_keys[i] for i in combo],
                "labels": [feature_labels[feature_keys[i]] for i in combo],
                "r2": round(r2, 6),
                "adj_r2": round(ar2, 6),
                "bic": round(b, 2),
            }
            for r2, combo, ar2, b in top
        ]
        best = top[0]
        elapsed = time.time() - start
        print(f"k={k:>2}  best R²={best[0]:.4f}  adj-R²={best[2]:.4f}  BIC={best[3]:>10.1f}  "
              f"features={[feature_labels[feature_keys[i]] for i in best[1]]}  "
              f"[{elapsed:.1f}s]")

    # Choose a parsimonious winner by an elbow on R².
    best_r2_by_k = {k: best_per_k[k][0]["r2"] for k in best_per_k}
    best_bic_by_k = {k: best_per_k[k][0]["bic"] for k in best_per_k}
    ks_sorted = sorted(best_r2_by_k.keys())
    elbow_k = ks_sorted[0]
    for a, b in zip(ks_sorted, ks_sorted[1:]):
        gain = best_r2_by_k[b] - best_r2_by_k[a]
        if gain < args.elbow:
            elbow_k = a
            break
        elbow_k = b
    bic_k = min(best_bic_by_k, key=best_bic_by_k.get)

    elbow_model = best_per_k[elbow_k][0]
    bic_model = best_per_k[bic_k][0]

    # Step-by-step comparison: best-at-k vs best-at-(k-1). For the partial
    # F-test we always use a nested comparison (best-k-1 plus the single
    # best additional variable), because best-at-k winners aren't required
    # to be nested in best-at-(k-1).
    step_rows: list[dict] = []
    for k in ks_sorted:
        if k == 1:
            continue
        prev = best_per_k[k - 1][0]
        curr = best_per_k[k][0]
        nested = set(prev["features"]).issubset(set(curr["features"]))
        prev_idx = [feature_keys.index(f) for f in prev["features"]]
        extra_idx = None
        best_extra_r2 = prev["r2"]
        for j in range(len(feature_keys)):
            if j in prev_idx:
                continue
            X = X_full[:, prev_idx + [j]]
            r2_j, _, _ = fit_ols(X, y)
            if r2_j > best_extra_r2:
                best_extra_r2 = r2_j
                extra_idx = j
        extra_label = (
            feature_labels[feature_keys[extra_idx]]
            if extra_idx is not None else "(geen verbetering)"
        )
        F_nested, p_nested = partial_f_test(
            r2_full=best_extra_r2, r2_reduced=prev["r2"], q=1, n=n, p_full=k
        )
        step_rows.append({
            "from_k": k - 1,
            "to_k": k,
            "nested": nested,
            "best_extra_feature": extra_label,
            "r2_prev": prev["r2"],
            "r2_curr": curr["r2"],
            "delta_r2": round(curr["r2"] - prev["r2"], 6),
            "cohens_f2": round(cohens_f2(curr["r2"], prev["r2"]), 4),
            "cohens_f2_label": effect_label(cohens_f2(curr["r2"], prev["r2"])),
            "partial_F_nested": round(F_nested, 2),
            "partial_F_p": float(f"{p_nested:.3g}"),
            "delta_bic": round(curr["bic"] - prev["bic"], 2),
        })

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(REPORT_JSON, "w") as f:
        json.dump({
            "n_rows": n,
            "candidate_features": feature_keys,
            "feature_labels": feature_labels,
            "best_per_k": best_per_k,
            "step_comparisons": step_rows,
            "elbow_delta_r2": args.elbow,
            "recommendations": {
                "parsimonious_elbow": {"k": elbow_k, **elbow_model},
                "lowest_bic":         {"k": bic_k,   **bic_model},
            },
        }, f, indent=2, allow_nan=False)

    lines = []
    lines.append("=" * 78)
    lines.append("BEST-SUBSET REGRESSION · PARCEL POINTS ON PC4 FEATURES")
    lines.append("=" * 78)
    lines.append(f"Training rows (complete-case, pop≥{MIN_POPULATION}, "
                 f"area≥{MIN_AREA_KM2}): {n}")
    lines.append(f"Candidate features: {len(feature_keys)}")
    lines.append(f"Subsets evaluated: {total_subsets:,}")
    lines.append("")
    lines.append(f"{'k':>3} {'best R²':>9} {'adj-R²':>9} {'BIC':>11}  features")
    lines.append("-" * 78)
    for k in ks_sorted:
        top = best_per_k[k][0]
        lines.append(
            f"{k:>3} {top['r2']:>9.4f} {top['adj_r2']:>9.4f} {top['bic']:>11.1f}  "
            + " + ".join(top["labels"])
        )
    lines.append("")
    lines.append("STAPSGEWIJZE TOEVOEGING (beste k vs beste k-1)")
    lines.append("-" * 78)
    lines.append(
        f"{'k':>3}→{'k+1':<4}{'ΔR²':>10}{'f²':>8} {'effect':<16}"
        f"{'F_nested':>10}{'p':>10}{'ΔBIC':>10}  nested?  extra var."
    )
    for s in step_rows:
        nested_mark = "ja" if s["nested"] else "nee"
        p_str = f"{s['partial_F_p']:.2g}" if s["partial_F_p"] > 0 else "< 1e-16"
        lines.append(
            f"{s['from_k']:>3}→{s['to_k']:<4}"
            f"{s['delta_r2']:>+10.4f}{s['cohens_f2']:>8.3f} "
            f"{s['cohens_f2_label']:<16}"
            f"{s['partial_F_nested']:>10.2f}{p_str:>10}"
            f"{s['delta_bic']:>+10.2f}  {nested_mark:<7}  "
            f"{s['best_extra_feature']}"
        )
    lines.append("")
    lines.append("Interpretatie:")
    lines.append("  - Partial F / p-waarde: is er genoeg signaal om één extra variabele")
    lines.append("    te rechtvaardigen? (nested F-test; vergelijkt best-k-1 tegen")
    lines.append("    best-k-1 + één beste toevoeging). p < 0.05 = statistisch ja.")
    lines.append("  - Cohen's f²: sample-size-onafhankelijke effectgrootte. Drempels:")
    lines.append("    ≥ 0.02 klein, ≥ 0.15 middel, ≥ 0.35 groot.")
    lines.append("  - ΔBIC: negatief = het grotere model is beter. ΔBIC ≤ -6 = sterk")
    lines.append("    bewijs, ≤ -10 = doorslaggevend. Bij grote n wint ΔBIC het van F.")
    lines.append("")
    lines.append("RECOMMENDATIONS")
    lines.append("-" * 78)
    lines.append(
        f"Parsimonious (elbow ΔR² < {args.elbow}): k={elbow_k}, R²={elbow_model['r2']}")
    lines.append("  features: " + " + ".join(elbow_model["labels"]))
    lines.append(
        f"Lowest BIC:                       k={bic_k}, BIC={bic_model['bic']}")
    lines.append("  features: " + " + ".join(bic_model["labels"]))
    lines.append("")
    lines.append("Leaderboard per k (top 5 subsets):")
    lines.append("-" * 78)
    for k in ks_sorted:
        lines.append(f"k={k}:")
        for i, m in enumerate(best_per_k[k], 1):
            lines.append(
                f"  #{i}  R²={m['r2']:.4f}  BIC={m['bic']:>9.1f}  "
                + " + ".join(m["labels"])
            )
        lines.append("")

    report_text = "\n".join(lines)
    REPORT_TXT.write_text(report_text)
    print("\n" + report_text)
    print(f"\n✓ Report written to {REPORT_TXT}")
    print(f"✓ Leaderboard JSON:  {REPORT_JSON}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
