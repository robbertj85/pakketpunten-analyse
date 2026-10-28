#!/usr/bin/env python3
"""
Parcel-point growth forecast to 2030, nationally and per gemeente.

The raw weekly counts mix real growth with changes in what we measure: carriers
entering the data, caches that froze for weeks, fetchers that were rewritten.
Extrapolating that curve would mostly extrapolate our own data work. So:

1. Clean (per carrier x category, nationally)
   - data/forecast_events.json lists known intros, resets, stale and invalid weeks.
   - Automatic safety net: zeros after a carrier's intro, runs of >= 4 identical
     counts, Hampel outliers on the log level, one-week drops > 8% and rises > 20%
     are not counted as growth. Rises of 8-20% are kept (carriers do sign shops
     in batches) but listed as unexplained.
   - Weekly organic log growth is only measured between two valid weeks with no
     break in between. Weeks without it take the pooled rate of the carriers that
     do have it. The cleaned series is anchored on today's count and rebuilt
     backwards, which is a chain-linked index: entering carriers add level, not
     growth.

2. Trend (per carrier x category)
   Damped additive trend on the log of the cleaned series (Holt / ETS AAdN). The
   damping factor is not identifiable from one year of data, so it is the
   scenario knob. The slope is shrunk towards the pooled slope when a carrier has
   few clean weeks. A logistic saturation term slows growth as the national total
   approaches K: every gemeente at the 90th-percentile density (points per 1,000
   inhabitants) of its urbanity class, times a headroom factor, with K moving
   along with the CBS/PBL population forecast. 1,000 simulated paths give the
   intervals.

3. Gemeenten
   National net additions per carrier x category are shared out over gemeenten,
   so gemeenten always sum to the national forecast. A gemeente's share mixes its
   own organic additions so far with a prior (its current share and its
   population x headroom), weighted like a Dirichlet posterior: small gemeenten
   with few additions lean on the prior. Allocation noise uses an overdispersion
   factor estimated from the weekly data.

4. Reliability and backtest
   The model is refit on the first 38 weeks and scored on the last 12, nationally
   (vs naive and undamped) and per gemeente (allocation error by size class).
   Each gemeente gets n_now, weeks_clean, noise_cv, snr, shrinkage_weight, its
   backtest error, the relative 2030 interval width, and a betrouwbaarheid label.

Everything is computed twice: punten (per carrier) and locaties (unique physical
locations, see scripts/point_categories.py), plus locaties with >= 2 carriers.

Inputs:  data/point_history.json, data/forecast_events.json,
         data/cbs/gemeente_population_forecast.json, webapp/public/municipalities.json
Outputs: webapp/public/data/forecast/{national,index,<slug>}.json
"""

import json
import math
import os
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
HISTORY = ROOT / "data" / "point_history.json"
EVENTS = ROOT / "data" / "forecast_events.json"
POPULATION = ROOT / "data" / "cbs" / "gemeente_population_forecast.json"
MUNICIPALITIES = ROOT / "webapp" / "public" / "municipalities.json"
OUT_DIR = ROOT / "webapp" / "public" / "data" / "forecast"

CATEGORIES = ("locker", "shop")
HORIZON_YEAR = 2030
N_PATHS = 1000
SEED = 20261028

# Automatic break detection thresholds (weekly log change of a national carrier series).
DROP_BREAK = math.log(1 - 0.08)
RISE_BREAK = math.log(1 + 0.20)
RISE_NOTE = math.log(1 + 0.08)
STALE_RUN = 4  # identical consecutive values before the repeats count as stale
HAMPEL_WINDOW = 2
HAMPEL_MIN = 0.03

PRIOR_CURRENT = 0.7  # weight of a gemeente's current share in its allocation prior
SHRINK_WEEKS = 13  # pseudo-weeks of pooled slope mixed into each carrier's slope
EXCESS_DECAY = 0.96  # weekly fade of a carrier's growth above/below the market (half-life ~17 weeks)
BACKTEST_TRAIN = 38
BACKTEST_TEST = 12

# Damping per week: growth half-life ~1 year (laag), ~2 years (midden), ~4.5 years (hoog).
# Headroom: how far above the 90th-percentile density of its urbanity class a
# gemeente can still grow.
SCENARIOS = {
    "laag": {"phi": 0.985, "headroom": 1.0, "quantile": 0.25},
    "midden": {"phi": 0.993, "headroom": 1.2, "quantile": 0.50},
    "hoog": {"phi": 0.997, "headroom": 1.5, "quantile": 0.75},
}
Z80 = 1.2816

EVENT_LABELS = {
    "intro": "{c} toegevoegd aan de data",
    "level_reset": "{c}: andere ophaalmethode",
    "stale": "{c}: verouderde cache",
    "invalid": "{c}: foutieve snapshot",
    "auto_drop": "{c}: onverklaarde daling (niet meegeteld)",
    "auto_rise": "{c}: sprong (niet meegeteld)",
    "auto_outlier": "{c}: uitschieter (genegeerd)",
    "auto_stale": "{c}: ongewijzigde telling (genegeerd)",
    "auto_gap": "{c}: ontbreekt in snapshot",
    "note_rise": "{c}: forse stijging (wel meegeteld)",
}


# --- calendar -----------------------------------------------------------------


def iso_monday(label: str) -> date:
    year, week = label.split("-W")
    return date.fromisocalendar(int(year), int(week), 1)


def iso_label(d: date) -> str:
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def week_month(label: str) -> str:
    """ISO convention: a week belongs to the month of its Thursday."""
    thursday = iso_monday(label) + timedelta(days=3)
    return f"{thursday.year}-{thursday.month:02d}"


def week_year(label: str) -> str:
    return label[:4]


# --- loading --------------------------------------------------------------------


def load_json(path: Path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def series_matrix(punten: dict, n: int):
    """{carrier: {cat: [..]}} -> ({(carrier, cat): np.array}) without all-zero series."""
    out = {}
    for carrier, cats in punten.items():
        for cat in CATEGORIES:
            arr = np.asarray(cats.get(cat, [0] * n), dtype=float)
            if arr.sum() > 0:
                out[(carrier, cat)] = arr
    return out


# --- stage 1: cleaning ----------------------------------------------------------


def registry_masks(events: list, weeks: list, carriers: set):
    """Per carrier: invalid[t] (no information) and brk[t] (change into t is not growth)."""
    idx = {w: i for i, w in enumerate(weeks)}
    n = len(weeks)
    invalid = {c: np.zeros(n, bool) for c in carriers}
    brk = {c: np.zeros(n, bool) for c in carriers}
    log = []
    for e in events:
        c = e["carrier"]
        if c not in carriers:
            continue
        if e["type"] == "stale":
            lo, hi = idx.get(e["from"]), idx.get(e["to"])
            if lo is None or hi is None:
                continue
            invalid[c][lo : hi + 1] = True
            log.append({"carrier": c, "type": "stale", "week": e["from"], "until": e["to"], "source": "register", "note": e.get("note")})
            continue
        t = idx.get(e["week"])
        if t is None:
            continue
        if e["type"] == "invalid":
            invalid[c][t] = True
        else:
            brk[c][t] = True
        log.append({"carrier": c, "type": e["type"], "week": e["week"], "source": "register", "note": e.get("note")})
    return invalid, brk, log


def clean_carrier(y: np.ndarray, invalid: np.ndarray, brk: np.ndarray, carrier: str, weeks: list, log: list):
    """
    Automatic cleaning of one national carrier total. Returns (valid, brk) masks.
    Mutates copies; appends detected events to log.
    """
    n = len(y)
    valid = (y > 0) & ~invalid
    brk = brk.copy()
    nonzero = np.flatnonzero(y > 0)
    if nonzero.size == 0:
        return valid, brk
    intro = nonzero[0]
    brk[intro] = True  # entering the data is never growth

    for t in range(intro + 1, n):
        if y[t] == 0 and not invalid[t]:
            log.append({"carrier": carrier, "type": "auto_gap", "week": weeks[t], "source": "auto"})

    # Runs of identical values: the repeats carry no information.
    t = intro
    while t < n:
        if not valid[t]:
            t += 1
            continue
        u = t
        while u + 1 < n and valid[u + 1] and y[u + 1] == y[t]:
            u += 1
        if u - t + 1 >= STALE_RUN:
            valid[t + 1 : u + 1] = False
            log.append({"carrier": carrier, "type": "auto_stale", "week": weeks[t + 1], "until": weeks[u], "source": "auto"})
        t = u + 1

    # Hampel filter on the log level of the valid points.
    pos = np.flatnonzero(valid)
    logy = np.log(np.where(y > 0, y, 1))
    for i, t in enumerate(pos):
        lo, hi = max(0, i - HAMPEL_WINDOW), min(len(pos), i + HAMPEL_WINDOW + 1)
        window = logy[pos[lo:hi]]
        if window.size < 4:
            continue
        med = np.median(window)
        mad = 1.4826 * np.median(np.abs(window - med))
        if abs(logy[t] - med) > max(3 * mad, HAMPEL_MIN):
            # A step change also trips Hampel at its first week; only treat it as
            # an outlier if the level comes back.
            nxt = pos[i + 1] if i + 1 < len(pos) else None
            prv = pos[i - 1] if i > 0 else None
            if nxt is not None and prv is not None and abs(logy[nxt] - logy[prv]) < abs(logy[t] - logy[prv]) / 2:
                valid[t] = False
                log.append({"carrier": carrier, "type": "auto_outlier", "week": weeks[t], "source": "auto"})

    # Jumps between consecutive valid weeks.
    pos = np.flatnonzero(valid)
    for a, b in zip(pos[:-1], pos[1:]):
        if brk[a + 1 : b + 1].any():
            continue
        r = logy[b] - logy[a]
        if r < DROP_BREAK:
            brk[b] = True
            log.append({"carrier": carrier, "type": "auto_drop", "week": weeks[b], "source": "auto", "change_pct": round(100 * (math.exp(r) - 1), 1)})
        elif r > RISE_BREAK:
            brk[b] = True
            log.append({"carrier": carrier, "type": "auto_rise", "week": weeks[b], "source": "auto", "change_pct": round(100 * (math.exp(r) - 1), 1)})
        elif r > RISE_NOTE:
            log.append({"carrier": carrier, "type": "note_rise", "week": weeks[b], "source": "auto", "change_pct": round(100 * (math.exp(r) - 1), 1)})
    return valid, brk


def category_breaks(y: np.ndarray, other: np.ndarray, valid: np.ndarray, brk: np.ndarray, label: str, weeks: list, log: list):
    """
    Breaks visible only in one category: a carrier can relabel points without
    its total moving (PostNL split automaten off servicepunten in 2026-W03).
    A relabel moves at least 5% of the carrier's points and the other category
    mirrors it; a fast locker rollout (InPost) does neither and stays growth.
    """
    brk = brk.copy()
    nonzero = np.flatnonzero(y > 0)
    if nonzero.size == 0:
        return brk
    brk[nonzero[0]] = True
    pos = np.flatnonzero(valid & (y > 0))
    logy = np.log(np.where(y > 0, y, 1))
    for a, b in zip(pos[:-1], pos[1:]):
        if brk[a + 1 : b + 1].any():
            continue
        r = logy[b] - logy[a]
        delta, mirrored = y[b] - y[a], other[a] - other[b]
        carrier_total = max(y[a] + other[a], 1)
        relabel = abs(delta) >= 0.05 * carrier_total and mirrored * np.sign(delta) >= 0.7 * abs(delta)
        if relabel and (r < DROP_BREAK or r > RISE_BREAK):
            brk[b] = True
            kind = "auto_drop" if r < 0 else "auto_rise"
            log.append({"carrier": label, "type": kind, "week": weeks[b], "source": "auto", "change_pct": round(100 * (math.exp(r) - 1), 1)})
    return brk


def organic_rates(y: np.ndarray, valid: np.ndarray, brk: np.ndarray):
    """Weekly log growth, spread evenly over gaps; NaN where it cannot be measured."""
    n = len(y)
    r = np.full(n, np.nan)
    pos = np.flatnonzero(valid & (y > 0))
    for a, b in zip(pos[:-1], pos[1:]):
        if brk[a + 1 : b + 1].any():
            continue
        r[a + 1 : b + 1] = (math.log(y[b]) - math.log(y[a])) / (b - a)
    return r


def pooled_rates(rates: dict, levels: dict, n: int):
    """Level-weighted mean organic rate per week over the series that have one."""
    num, den = np.zeros(n), np.zeros(n)
    for key, r in rates.items():
        w = levels[key]
        ok = ~np.isnan(r)
        num[ok] += r[ok] * w[ok]
        den[ok] += w[ok]
    pooled = np.where(den > 0, num / np.maximum(den, 1e-9), np.nan)
    fill = np.nanmean(pooled) if np.isfinite(pooled).any() else 0.0
    return np.where(np.isnan(pooled), fill, pooled)


def anchor_backwards(last_level: float, r: np.ndarray, pooled: np.ndarray, end: int):
    """Chain-linked cleaned series ending at last_level at index end."""
    n = len(r)
    out = np.full(n, np.nan)
    out[end] = last_level
    for t in range(end, 0, -1):
        g = r[t] if not np.isnan(r[t]) else pooled[t]
        out[t - 1] = out[t] / math.exp(g)
    for t in range(end + 1, n):
        g = r[t] if not np.isnan(r[t]) else pooled[t]
        out[t] = out[t - 1] * math.exp(g)
    return out


def ols(x: np.ndarray, y: np.ndarray):
    """Simple linear regression y = a + b x with R2 and the standard error of b."""
    ok = np.isfinite(x) & np.isfinite(y)
    x, y = x[ok], y[ok]
    n = len(x)
    if n < 3 or np.ptp(x) == 0:
        return None
    b, a = np.polyfit(x, y, 1)
    resid = y - (a + b * x)
    ss_res = float(np.sum(resid**2))
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    se = math.sqrt(ss_res / (n - 2) / float(np.sum((x - x.mean()) ** 2))) if n > 2 else float("nan")
    return {
        "intercept": float(a),
        "helling": float(b),
        "se": se,
        "r2": 1 - ss_res / ss_tot if ss_tot > 0 else None,
        "n": n,
    }


def log_trend(series: np.ndarray, start: int, end: int):
    """OLS on the log of a cleaned series: weekly growth, yearly growth, R2."""
    t = np.arange(start, end + 1, dtype=float)
    fit = ols(t, np.log(series[start : end + 1]))
    if fit is None:
        return None
    fit["groei_per_jaar_pct"] = 100 * (math.exp(52 * fit["helling"]) - 1)
    fit["groei_per_jaar_95"] = [
        100 * (math.exp(52 * (fit["helling"] - 1.96 * fit["se"])) - 1),
        100 * (math.exp(52 * (fit["helling"] + 1.96 * fit["se"])) - 1),
    ]
    return fit


def rounded(d, digits=5):
    if d is None:
        return None
    return {k: (round(v, digits) if isinstance(v, float) else [round(x, 3) for x in v] if isinstance(v, list) else v) for k, v in d.items()}


# --- stage 2: damped trend ------------------------------------------------------


def holt_fit(x: np.ndarray, phi: float = 0.99):
    """Grid-search ETS(A,Ad,N) on x. Returns (level, slope, sigma)."""
    best = None
    b0 = float(np.mean(np.diff(x[: min(5, len(x))]))) if len(x) > 1 else 0.0
    for alpha in (0.2, 0.35, 0.5, 0.65, 0.8, 0.95):
        for beta in (0.01, 0.03, 0.06, 0.1, 0.2):
            level, slope, sse, errs = x[0], b0, 0.0, []
            for v in x[1:]:
                pred = level + phi * slope
                e = v - pred
                errs.append(e)
                sse += e * e
                level = pred + alpha * e
                slope = phi * slope + beta * e
            if best is None or sse < best[0]:
                best = (sse, level, slope, errs)
    _, level, slope, errs = best
    errs = np.asarray(errs) if errs else np.zeros(1)
    sigma = max(1.4826 * float(np.median(np.abs(errs - np.median(errs)))), 0.002)
    return level, slope, sigma


def fit_series(clean: np.ndarray, r: np.ndarray, start: int, end: int, prior_slope: float):
    x = np.log(clean[start : end + 1])
    n_obs = int((~np.isnan(r[start + 1 : end + 1])).sum())
    if len(x) >= 6:
        level, slope, sigma = holt_fit(x)
    else:
        level, slope, sigma = x[-1], prior_slope, 0.01
    slope = (n_obs * slope + SHRINK_WEEKS * prior_slope) / (n_obs + SHRINK_WEEKS)
    # Uncertainty of the slope itself dominates a multi-year horizon. Weekly
    # organic rates give its standard error; the pooled prior counts as
    # SHRINK_WEEKS extra observations.
    obs = r[start + 1 : end + 1]
    obs = obs[~np.isnan(obs)]
    sd_r = float(np.std(obs)) if obs.size > 2 else 0.01
    slope_se = max(sd_r, 0.002) / math.sqrt(n_obs + SHRINK_WEEKS)
    return {
        "level": float(x[-1]),
        "slope": float(slope),
        "slope_se": float(slope_se),
        "sigma": float(sigma),
        "n_obs": n_obs,
        "smoothed_level": float(level),
    }


def simulate(fits: list, horizon: int, phi: float, cap_ratio: np.ndarray, rng, market: dict, unc: float = 1.0, n_paths=N_PATHS):
    """
    Joint simulation of all series; returns levels (n_series, horizon, n_paths).

    Each series' weekly log growth is the market slope plus its own excess. The
    market slope damps with phi (the scenario knob); the excess, e.g. a newcomer
    rolling out lockers, fades faster with EXCESS_DECAY, so no carrier keeps
    compounding at its launch pace for four years. The market slope draw is
    shared by all series, so their uncertainty adds up instead of cancelling.
    cap_ratio[h] = K(h) / N_now drives the logistic saturation brake.
    unc scales all uncertainty; it is calibrated on the rolling backtest.
    """
    s = len(fits)
    level = np.array([f["level"] for f in fits])[:, None].repeat(n_paths, 1)
    m_slope = market["slope"] + rng.standard_normal(n_paths)[None, :] * market["se"] * unc
    excess = (np.array([f["slope"] for f in fits]) - market["slope"])[:, None] + rng.standard_normal((s, n_paths)) * (
        np.array([f["slope_se"] for f in fits])[:, None] * unc
    )
    sigma = np.array([f["sigma"] for f in fits])[:, None] * unc
    base = np.exp(level[:, 0]).sum()
    f0 = max(1 - 1 / cap_ratio[0], 1e-3)
    out = np.empty((s, horizon, n_paths))
    for h in range(horizon):
        total = np.exp(level).sum(axis=0)
        sat = np.clip((1 - total / (base * cap_ratio[h])) / f0, 0.0, 1.5)
        m_slope = phi * m_slope
        excess = EXCESS_DECAY * excess
        trend = m_slope + excess
        # Saturation only brakes growth; a shrinking carrier shrinks as is.
        trend = np.where(trend > 0, trend * sat, trend)
        level = level + trend
        out[:, h, :] = np.exp(level + rng.standard_normal((s, n_paths)) * sigma)
    return out


def simulate_scalar(fit: dict, horizon: int, phi: float, sat_paths: np.ndarray, rng, unc: float = 1.0, n_paths=N_PATHS):
    """One series (locaties) sharing the punten saturation factor per path."""
    level = np.full(n_paths, fit["level"])
    slope = fit["slope"] + rng.standard_normal(n_paths) * fit["slope_se"] * unc
    out = np.empty((horizon, n_paths))
    for h in range(horizon):
        slope = phi * slope
        trend = np.where(slope > 0, slope * sat_paths[h], slope)
        level = level + trend
        out[h] = np.exp(level + rng.standard_normal(n_paths) * fit["sigma"] * unc)
    return out


def saturation_factor(totals: np.ndarray, base: float, cap_ratio: np.ndarray):
    """Recompute the per-path saturation factor from simulated totals (horizon, paths)."""
    f0 = max(1 - 1 / cap_ratio[0], 1e-3)
    prev = np.vstack([np.full((1, totals.shape[1]), base), totals[:-1]])
    return np.clip((1 - prev / (base * cap_ratio[:, None])) / f0, 0.0, 1.5)


# --- helpers for output -----------------------------------------------------------


def period_index(labels: list, key):
    """Map each week to its period; return (period labels, last week index per period)."""
    order, last = [], {}
    for i, w in enumerate(labels):
        p = key(w)
        if p not in last:
            order.append(p)
        last[p] = i
    return order, [last[p] for p in order]


def r0(v):
    return None if v is None or (isinstance(v, float) and not math.isfinite(v)) else int(round(v))


def take(arr, idxs):
    return [r0(arr[i]) if arr[i] is not None else None for i in idxs]


# --- main -------------------------------------------------------------------------


def main():
    hist = load_json(HISTORY)
    weeks = hist["weeks"]
    n = len(weeks)
    T = n - 1
    events_cfg = load_json(EVENTS)["events"]
    pop = load_json(POPULATION)
    munis = {m["slug"]: m for m in load_json(MUNICIPALITIES) if m.get("slug") != "nederland"}
    rng = np.random.default_rng(SEED)

    nat = series_matrix(hist["national"]["punten"], n)
    carriers = {c for c, _ in nat}
    invalid_reg, brk_reg, event_log = registry_masks(events_cfg, weeks, carriers)

    # Carrier-level cleaning on the carrier total; categories inherit the masks.
    valid_c, brk_c = {}, {}
    for c in sorted(carriers):
        total = sum(nat.get((c, k), np.zeros(n)) for k in CATEGORIES)
        valid_c[c], brk_c[c] = clean_carrier(total, invalid_reg[c], brk_reg[c], c, weeks, event_log)

    cat_label = {"locker": "automaat", "shop": "bemand punt"}
    brk_k = {
        key: category_breaks(
            y,
            nat.get((key[0], "shop" if key[1] == "locker" else "locker"), np.zeros(n)),
            valid_c[key[0]],
            brk_c[key[0]],
            f"{key[0]} ({cat_label[key[1]]})",
            weeks,
            event_log,
        )
        for key, y in nat.items()
    }
    rates = {key: organic_rates(y, valid_c[key[0]], brk_k[key]) for key, y in nat.items()}
    pooled = pooled_rates(rates, nat, n)

    def last_valid(key):
        pos = np.flatnonzero(valid_c[key[0]] & (nat[key] > 0))
        return int(pos[-1]) if pos.size else None

    clean = {}
    for key, y in nat.items():
        lv = last_valid(key)
        if lv is None:
            continue
        # Anchor on the latest count even when the last week is a break: today's
        # level is real, only the jump into it is not growth.
        anchor_t = T if y[T] > 0 and not invalid_reg[key[0]][T] else lv
        clean[key] = anchor_backwards(float(y[anchor_t]), rates[key], pooled, anchor_t)
        if anchor_t < T:
            clean[key][anchor_t + 1 :] = clean[key][anchor_t]

    raw_total = sum(nat.values())
    clean_total = sum(clean.values())
    # A plain linear trend on the cleaned log series, shown next to the damped
    # model so readers can see the regression line and its fit.
    total_trend = log_trend(clean_total, 0, T)
    trend_line = np.exp(total_trend["intercept"] + total_trend["helling"] * np.arange(n))
    weekly_growth = np.r_[np.nan, clean_total[1:] / clean_total[:-1] - 1]

    # Locaties: national series has no carrier, so breaks are the union of
    # carrier breaks and invalid weeks.
    loc = np.asarray(hist["national"]["locaties"], float)
    multi = np.asarray(hist["national"]["locaties_multi"], float)
    any_brk = np.zeros(n, bool)
    any_invalid = np.zeros(n, bool)
    for c in carriers:
        any_brk |= brk_c[c]
        any_invalid |= invalid_reg[c]
    loc_valid = (loc > 0) & ~any_invalid
    loc_r = organic_rates(loc, loc_valid, any_brk)
    loc_pool = np.where(np.isnan(loc_r), np.nanmean(loc_r), loc_r)
    loc_clean = anchor_backwards(loc[T], loc_r, loc_pool, T)

    # Multi-carrier share follows punten per locatie: every extra carrier at a
    # location is either a new location or turns a single one into a shared one.
    # The national weekly relation gives the slope; forecasts move each area's
    # share along it from where that area is today.
    ratio_hist = raw_total / np.maximum(loc, 1)
    share_hist = multi / np.maximum(loc, 1)
    multi_fit = ols(ratio_hist[loc_valid], share_hist[loc_valid])
    multi_beta = multi_fit["helling"]

    def multi_share_at(share_now, ratio_now, ratio_future):
        return np.clip(share_now + multi_beta * (ratio_future - ratio_now), 0.0, 1.0)

    # --- saturation ceiling ---
    gem_pop = {}
    for slug, m in munis.items():
        info = pop["gemeenten"].get(m.get("code") or "")
        if info and info.get("inwoners"):
            gem_pop[slug] = info
    gem_hist = hist["municipalities"]

    def gem_points_now(slug):
        g = gem_hist.get(slug)
        if not g:
            return 0
        return sum(cats[k][T] for cats in g["punten"].values() for k in CATEGORIES)

    by_class = defaultdict(list)
    for slug, info in gem_pop.items():
        by_class[info["stedelijkheid"]].append(1000 * gem_points_now(slug) / info["inwoners"])
    cap_density = {cls: float(np.percentile(v, 90)) for cls, v in by_class.items()}

    last_week = weeks[T]
    future = []
    d = iso_monday(last_week) + timedelta(days=7)
    while d.isocalendar()[0] <= HORIZON_YEAR:
        future.append(iso_label(d))
        d += timedelta(days=7)
    H = len(future)
    all_weeks = weeks + future

    def pop_index(info, label):
        idx = info.get("pop_index") or {}
        monday = iso_monday(label)
        y0 = str(monday.year)
        y1 = str(monday.year + 1)
        if y0 not in idx:
            return idx.get(str(HORIZON_YEAR + 1), 1.0)
        frac = (monday.timetuple().tm_yday - 1) / 365.0
        return idx[y0] + (idx.get(y1, idx[y0]) - idx[y0]) * frac

    def capacity(headroom, labels):
        out = np.zeros(len(labels))
        for slug, info in gem_pop.items():
            cap = cap_density.get(info["stedelijkheid"], 0) * headroom * info["inwoners"] / 1000
            # Never below what a gemeente already has: K is a ceiling for growth.
            cap = max(cap, gem_points_now(slug) * 1.02)
            out += np.array([cap * pop_index(info, w) for w in labels])
        return out

    keys = sorted(clean)

    def market_at(end):
        """Market slope: mean pooled organic rate over weeks 1..end, with its standard error."""
        window = pooled[1 : end + 1]
        return {"slope": float(np.mean(window)), "se": float(np.std(window) / math.sqrt(len(window)))}

    def fit_all(end, subset=None):
        market = market_at(end)
        fits = []
        for key in subset or keys:
            start = min(int(np.flatnonzero(nat[key] > 0)[0]), end)
            fits.append(fit_series(clean[key], rates[key], start, end, market["slope"]))
        return fits, market

    def q(arr, p):
        return np.quantile(arr, p, axis=-1)

    def mape(pred, act):
        return float(np.mean(np.abs(pred - act) / act) * 100)

    # --- rolling-origin backtest and interval calibration ---
    # Refit at several origins, forecast 12 weeks, compare with the cleaned
    # series. The uncertainty multiplier is the smallest one whose P10-P90 band
    # holds at least 80% of the actual values: the bands are calibrated on how
    # wrong the model really was, not on its own assumptions.
    no_cap = np.full(BACKTEST_TEST, 10.0)
    origins = list(range(19, T - BACKTEST_TEST + 1, 2))
    unc_grid = (1.0, 1.5, 2.0, 3.0, 4.0, 6.0, 8.0)
    runs = []
    for t0 in origins:
        subset = [k for k in keys if np.flatnonzero(nat[k] > 0)[0] <= t0 - 8]
        bt_fits, market = fit_all(t0, subset)
        actual = sum(clean[k] for k in subset)[t0 + 1 : t0 + 1 + BACKTEST_TEST]
        base_t0 = float(sum(clean[k][t0] for k in subset))
        sims = {
            u: simulate(bt_fits, BACKTEST_TEST, SCENARIOS["midden"]["phi"], no_cap, np.random.default_rng(SEED), market, u, 400).sum(0)
            for u in unc_grid
        }
        lin = simulate(bt_fits, BACKTEST_TEST, 1.0, no_cap, np.random.default_rng(SEED), market, 1.0, 400).sum(0)
        runs.append({"t0": t0, "actual": actual, "base": base_t0, "sims": sims, "lin": np.median(lin, axis=1)})

    def coverage(u):
        hits = [((r["actual"] >= q(r["sims"][u], 0.1)) & (r["actual"] <= q(r["sims"][u], 0.9))) for r in runs]
        return float(np.mean(np.concatenate(hits)))

    unc = next((u for u in unc_grid if coverage(u) >= 0.8), unc_grid[-1])
    backtest = {
        "methode": f"Rollende terugtoets: {len(runs)} startpunten ({weeks[origins[0]]} t/m {weeks[origins[-1]]}), telkens {BACKTEST_TEST} weken vooruit op de gecorrigeerde reeks",
        "mape_model": round(float(np.mean([mape(np.median(r["sims"][1.0], axis=1), r["actual"]) for r in runs])), 2),
        "mape_naive": round(float(np.mean([mape(np.full_like(r["actual"], r["base"]), r["actual"]) for r in runs])), 2),
        "mape_linear": round(float(np.mean([mape(r["lin"], r["actual"]) for r in runs])), 2),
        "onzekerheid_factor": unc,
        "dekking_p10_p90_pct": round(100 * coverage(unc), 1),
        "dekking_ongekalibreerd_pct": round(100 * coverage(1.0), 1),
        "per_startpunt": [
            {
                "week": weeks[r["t0"]],
                "werkelijke_groei_pct": round(100 * (r["actual"][-1] / r["base"] - 1), 2),
                "voorspelde_groei_pct": round(100 * (float(np.median(r["sims"][1.0][-1])) / r["base"] - 1), 2),
            }
            for r in runs
        ],
    }

    fits, market = fit_all(T)
    now_total = float(clean_total[T])

    # --- national simulation per scenario ---
    loc_fit = fit_series(loc_clean, loc_r, 0, T, float(np.nanmean(loc_r)))
    scen_out = {}
    for name, sc in SCENARIOS.items():
        cap_ratio = capacity(sc["headroom"], future) / now_total
        paths = simulate(fits, H, sc["phi"], cap_ratio, rng, market, unc)  # (S, H, P)
        totals = paths.sum(axis=0)
        sat = saturation_factor(totals, now_total, cap_ratio)
        loc_paths = np.minimum(simulate_scalar(loc_fit, H, sc["phi"], sat, rng, unc), totals)
        scen_out[name] = {"paths": paths, "totals": totals, "loc": loc_paths, "cap": cap_ratio * now_total}

    # --- gemeenten ---
    gem_slugs = sorted(s for s in gem_hist if s in munis)
    G = len(gem_slugs)
    gidx = {s: i for i, s in enumerate(gem_slugs)}

    def gem_series(slug, key):
        cats = gem_hist[slug]["punten"].get(key[0])
        if not cats:
            return np.zeros(n)
        return np.asarray(cats[key[1]], float)

    gem_y = {key: np.vstack([gem_series(s, key) for s in gem_slugs]) for key in keys}  # (G, n)
    gem_total = sum(gem_y.values())
    # A gemeente week whose total falls below half its neighbourhood median is a
    # file glitch (failed generate), not a closure wave.
    gem_ok = np.ones((G, n), bool)
    for t in range(n):
        lo_t, hi_t = max(0, t - 2), min(n, t + 3)
        neigh = np.median(np.delete(gem_total[:, lo_t:hi_t], t - lo_t, axis=1), axis=1)
        gem_ok[:, t] = ~((neigh >= 4) & (gem_total[:, t] < 0.5 * neigh))

    def organic_mask(key):
        """(n,) True where the change into t is organic for this national series."""
        m = ~np.isnan(rates[key])
        return m

    def gem_organic_adds(key, upto):
        """Net organic additions per gemeente over weeks 1..upto, and per week."""
        y = gem_y[key]
        m = organic_mask(key)
        diffs = np.zeros((G, n))
        diffs[:, 1:] = y[:, 1:] - y[:, :-1]
        ok = np.zeros((G, n), bool)
        ok[:, 1:] = gem_ok[:, 1:] & gem_ok[:, :-1] & m[None, 1:]
        diffs = np.where(ok, diffs, 0.0)
        diffs[:, upto + 1 :] = 0.0
        return diffs, ok

    # Prior per gemeente: mostly its current share of the series (carriers grow
    # where they are), partly population x room below the density ceiling.
    def headroom_weight(slug):
        info = gem_pop.get(slug)
        if not info:
            return 0.0
        cap = cap_density.get(info["stedelijkheid"], 0) * SCENARIOS["midden"]["headroom"] * info["inwoners"] / 1000
        return max(cap - gem_points_now(slug), 0.05 * cap)

    room = np.array([headroom_weight(s) for s in gem_slugs])
    room_share = room / room.sum()

    def shares(key, upto):
        diffs, _ = gem_organic_adds(key, upto)
        adds = np.clip(diffs.sum(axis=1), 0, None)
        cur = gem_y[key][:, upto]
        cur_share = cur / cur.sum() if cur.sum() > 0 else room_share
        prior = PRIOR_CURRENT * cur_share + (1 - PRIOR_CURRENT) * room_share
        alpha = max(adds.sum(), 25.0)
        post = (adds + alpha * prior) / (adds.sum() + alpha)
        return post, cur_share, adds, alpha * prior

    share = {}
    for key in keys:
        post, cur, adds, prior_mass = shares(key, T)
        share[key] = {"post": post, "cur": cur}

    # Total-level shrinkage weight and dispersion.
    total_adds = np.zeros(G)
    total_prior = np.zeros(G)
    weekly_adds = np.zeros((G, n))
    weekly_ok = np.zeros((G, n), bool)
    for key in keys:
        diffs, ok = gem_organic_adds(key, T)
        weekly_adds += diffs
        weekly_ok |= ok
        _, _, adds, prior_mass = shares(key, T)
        total_adds += adds
        total_prior += prior_mass
    shrink_w = total_adds / np.maximum(total_adds + total_prior, 1e-9)

    post_total = sum(share[k]["post"] * max(float(gem_y[k][:, T].sum()), 1) for k in keys)
    post_total = post_total / post_total.sum()
    nat_week_adds = weekly_adds.sum(axis=0)
    exp_ = post_total[:, None] * nat_week_adds[None, :]
    var_bin = np.abs(nat_week_adds)[None, :] * post_total[:, None] * (1 - post_total[:, None])
    sel = np.abs(nat_week_adds) > 0
    dispersion = float(np.clip(((weekly_adds - exp_) ** 2)[:, sel].sum() / max(var_bin[:, sel].sum(), 1e-9), 1.0, 50.0))

    # Locaties per gemeente follow its punten forecast: each gemeente keeps its own
    # punten-per-locatie ratio, moving along with the national ratio, and the
    # result is rescaled to the national locaties forecast.
    gem_loc = np.vstack([np.asarray(gem_hist[s]["locaties"], float) for s in gem_slugs])
    gem_multi = np.vstack([np.asarray(gem_hist[s]["locaties_multi"], float) for s in gem_slugs])
    gem_ratio_now = gem_total[:, T] / np.maximum(gem_loc[:, T], 1)

    # --- gemeente backtest: allocation only (national additions taken as known) ---
    bt_err_model = np.full(G, np.nan)
    bt_err_naive = np.full(G, np.nan)
    pred_adds = np.zeros(G)
    act_adds = np.zeros(G)
    for key in keys:
        if np.flatnonzero(nat[key] > 0)[0] > t0 - 8:
            continue
        post, cur, _, _ = shares(key, t0)
        diffs, _ = gem_organic_adds(key, T)
        test = diffs[:, t0 + 1 : t0 + 1 + BACKTEST_TEST].sum(axis=1)
        nat_test = test.sum()
        pred_adds += (post if nat_test >= 0 else cur) * nat_test
        act_adds += test
    base_g = np.maximum(gem_total[:, t0], 5)
    bt_err_model = np.abs(pred_adds - act_adds) / base_g * 100
    bt_err_naive = np.abs(act_adds) / base_g * 100

    size_classes = [("<15", 0, 15), ("15-50", 15, 50), ("50-200", 50, 200), (">200", 200, 1e9)]
    bt_by_size = []
    for label, lo_s, hi_s in size_classes:
        m = (gem_total[:, T] >= lo_s) & (gem_total[:, T] < hi_s)
        if m.any():
            bt_by_size.append({
                "klasse": label,
                "gemeenten": int(m.sum()),
                "fout_model_pct": round(float(np.median(bt_err_model[m])), 2),
                "fout_naief_pct": round(float(np.median(bt_err_naive[m])), 2),
            })
    backtest["gemeenten_per_grootte"] = bt_by_size
    backtest["allocatie_dispersie"] = round(dispersion, 2)

    # --- periods ---
    week_periods = all_weeks
    month_labels, month_last = period_index(all_weeks, week_month)
    year_labels, year_last = period_index(all_weeks, week_year)
    granularities = {
        "week": (week_periods, list(range(len(all_weeks)))),
        "maand": (month_labels, month_last),
        "jaar": (year_labels, year_last),
    }

    def pack_stock(hist_arr, fut_q):
        """hist_arr (n,), fut_q dict p10/p50/p90 -> per granularity aligned arrays."""
        res = {}
        for g, (labels, last_idx) in granularities.items():
            entry = {"p10": [], "p50": [], "p90": []}
            for i in last_idx:
                for p in entry:
                    if i < n:
                        entry[p].append(r0(hist_arr[i]) if i == T else None)
                    else:
                        entry[p].append(r0(fut_q[p][i - n]))
            res[g] = entry
        return res

    def pack_hist(arr):
        return {g: [r0(arr[i]) if i < n else None for i in last_idx] for g, (_, last_idx) in granularities.items()}

    def pack_flow(full):
        """full: (n+H,) stock (history + p50 forecast) -> net change per period."""
        res = {}
        for g, (labels, last_idx) in granularities.items():
            vals, prev = [], None
            for i in last_idx:
                cur = full[i]
                vals.append(None if prev is None else r0(cur - prev))
                prev = cur
            res[g] = vals
        return res

    def quant_dict(paths, p_mid, lohi=(0.1, 0.9)):
        return {"p10": q(paths, lohi[0]), "p50": q(paths, p_mid), "p90": q(paths, lohi[1])}

    # National output.
    national_scen = {}
    for name, sc in SCENARIOS.items():
        so = scen_out[name]
        pm = sc["quantile"]
        tot_q = quant_dict(so["totals"], pm)
        cat_q = {}
        for k in CATEGORIES:
            idx = [i for i, key in enumerate(keys) if key[1] == k]
            cat_paths = so["paths"][idx].sum(axis=0)
            cat_hist = sum(nat[key] for key in keys if key[1] == k)
            cat_q[k] = {"stock": pack_stock(cat_hist, quant_dict(cat_paths, pm))}
            cat_full = np.r_[cat_hist, quant_dict(cat_paths, pm)["p50"]]
            cat_q[k]["flow"] = pack_flow(cat_full)
        # Rescale per-series medians so carriers add up to the total median.
        key_adds = [q(so["paths"][i], pm) - nat[key][T] for i, key in enumerate(keys)]
        summed = sum(key_adds)
        target = tot_q["p50"] - raw_total[T]
        scale = np.where(np.abs(summed) > 1e-6, target / np.where(np.abs(summed) > 1e-6, summed, 1), 1.0)
        per_carrier = defaultdict(dict)
        for i, key in enumerate(keys):
            p = nat[key][T] + key_adds[i] * scale
            full = np.r_[nat[key], p]
            per_carrier[key[0]][key[1]] = {g: [r0(full[j]) for j in last_idx] for g, (_, last_idx) in granularities.items() if g != "week"}
        total_full = np.r_[raw_total, tot_q["p50"]]
        loc_q = quant_dict(so["loc"], pm)
        m_share = multi_share_at(share_hist[T], ratio_hist[T], tot_q["p50"] / np.maximum(loc_q["p50"], 1))
        multi_q = {p: m_share * loc_q[p] for p in loc_q}
        national_scen[name] = {
            "punten": {"stock": pack_stock(raw_total, tot_q), "flow": pack_flow(total_full)},
            "categorie": cat_q,
            "per_vervoerder": per_carrier,
            "locaties": {"stock": pack_stock(loc, loc_q), "flow": pack_flow(np.r_[loc, loc_q["p50"]])},
            "locaties_multi": {"stock": pack_stock(multi, multi_q)},
            "plafond": {g: [r0(so["cap"][i - n]) if i >= n else None for i in last_idx] for g, (_, last_idx) in granularities.items()},
        }

    def end_of_year(arr_full, year):
        idx = max(i for i, w in enumerate(all_weeks) if week_year(w) == str(year))
        return arr_full[idx]

    # Event list for the chart, deduplicated per (carrier, type, week).
    seen = set()
    events_out = []
    for e in sorted(event_log, key=lambda e: (e["week"], e["carrier"])):
        k = (e["carrier"], e["type"], e["week"])
        if k in seen:
            continue
        seen.add(k)
        e = {kk: v for kk, v in e.items() if v is not None}
        e["label"] = EVENT_LABELS.get(e["type"], e["type"]).format(c=e["carrier"])
        events_out.append(e)

    methodology = {
        "opschoning": "Per vervoerder en categorie telt alleen de wekelijkse verandering tussen twee geldige weken zonder meetbreuk als groei. Toetreding van een vervoerder, een andere ophaalmethode, een bevroren cache of een foutieve snapshot verandert het niveau, maar telt niet als groei (kettingindex, zoals bij prijsindexen met een wisselend pakket). Weken zonder meetbare groei krijgen het gewogen gemiddelde van de vervoerders die wel meetbaar waren.",
        "trend": "Gedempte trend (Holt / ETS AAdN) op het logaritme van de gecorrigeerde reeks per vervoerder en categorie. De helling wordt bij weinig schone weken naar de gezamenlijke helling getrokken. De demping is de scenariokeuze, omdat een jaar data die niet betrouwbaar bepaalt.",
        "verzadiging": "Groei remt af naarmate het landelijk totaal het plafond nadert: iedere gemeente op de dichtheid (punten per 1.000 inwoners) van het 90e percentiel van haar stedelijkheidsklasse, maal de scenario-ruimte, meebewegend met de CBS/PBL-bevolkingsprognose (COROP-niveau).",
        "gemeenten": "Landelijke netto groei per vervoerder en categorie wordt over gemeenten verdeeld, zodat gemeenten optellen tot landelijk. Het aandeel van een gemeente combineert haar eigen organische groei met een verwachting op basis van huidig aandeel en inwoners x ruimte tot het plafond; kleine gemeenten met weinig groei leunen meer op die verwachting.",
        "punten_vs_locaties": "Punten telt ieder punt per vervoerder; locaties telt unieke fysieke plekken (binnen 15 m, of binnen 40 m met hetzelfde adres). Een stijgend aantal punten per locatie betekent meer gedeelde (white-label) locaties.",
        "beperkingen": "Ruim een jaar historie onder een horizon van ruim vier jaar: lees de uitkomsten als scenario's, niet als voorspelling. Seizoenspatronen zijn met 50 weken niet te schatten. Nieuwe vervoerders die nog moeten toetreden zitten er niet in.",
        "scenarios": {k: {"demping_per_week": v["phi"], "ruimte_boven_p90": v["headroom"], "kwantiel": v["quantile"]} for k, v in SCENARIOS.items()},
    }

    periods = {g: labels for g, (labels, _) in granularities.items()}
    forecast_from = {g: next(j for j, i in enumerate(last_idx) if i >= T) for g, (_, last_idx) in granularities.items()}

    def headline(stock_hist_T, mid_full, lo_full, hi_full, loc_T, loc_full):
        v2030 = end_of_year(mid_full, HORIZON_YEAR)
        years = (iso_monday(f"{HORIZON_YEAR}-W52") - iso_monday(last_week)).days / 365.25
        return {
            "nu": r0(stock_hist_T),
            "y2030": r0(v2030),
            "y2030_laag": r0(end_of_year(lo_full, HORIZON_YEAR)),
            "y2030_hoog": r0(end_of_year(hi_full, HORIZON_YEAR)),
            "cagr_pct": round(100 * ((v2030 / max(stock_hist_T, 1)) ** (1 / years) - 1), 2),
            "locaties_nu": r0(loc_T),
            "locaties_2030": r0(end_of_year(loc_full, HORIZON_YEAR)),
        }

    def scen_full(name, which="totals"):
        so = scen_out[name]
        pm = SCENARIOS[name]["quantile"]
        hist_arr = raw_total if which == "totals" else loc
        return np.r_[hist_arr, q(so[which if which != "totals" else "totals"], pm)]

    nat_head = headline(
        raw_total[T], scen_full("midden"), scen_full("laag"), scen_full("hoog"), loc[T], scen_full("midden", "loc")
    )
    locker_now = float(sum(nat[k][T] for k in keys if k[1] == "locker"))
    mid = scen_out["midden"]
    locker_idx = [i for i, k in enumerate(keys) if k[1] == "locker"]
    locker_2030 = float(np.median(mid["paths"][locker_idx].sum(0), axis=1)[-1])
    nat_head["aandeel_automaat_nu_pct"] = round(100 * locker_now / raw_total[T], 1)
    nat_head["aandeel_automaat_2030_pct"] = round(100 * locker_2030 / float(np.median(mid["totals"], axis=1)[-1]), 1)
    nat_head["punten_per_locatie_nu"] = round(raw_total[T] / loc[T], 3)
    nat_head["punten_per_locatie_2030"] = round(float(np.median(mid["totals"], axis=1)[-1] / np.median(mid["loc"], axis=1)[-1]), 3)
    nat_head["multi_aandeel_nu_pct"] = round(100 * multi[T] / loc[T], 1)
    nat_head["multi_aandeel_2030_pct"] = round(
        100 * float(multi_share_at(share_hist[T], ratio_hist[T], nat_head["punten_per_locatie_2030"])), 1
    )

    # Regression lines per chart view (log-linear on the cleaned series).
    national_trends = {
        "punten": total_trend,
        "locaties": log_trend(loc_clean, 0, T),
        **{k: log_trend(sum(clean[key] for key in keys if key[1] == k), 0, T) for k in CATEGORIES},
    }

    generated = datetime.now(timezone.utc).isoformat(timespec="seconds")
    national = {
        "generated_at": generated,
        "slug": "nederland",
        "naam": "Nederland",
        "last_week": last_week,
        "periods": periods,
        "forecast_from": forecast_from,
        "headline": nat_head,
        "history": {
            "punten_raw": pack_hist(raw_total),
            "punten_clean": pack_hist(clean_total),
            "locaties_raw": pack_hist(loc),
            "locaties_clean": pack_hist(loc_clean),
            "punten_trend_ols": pack_hist(trend_line),
            "trend_ols": {
                name: pack_hist(np.exp(fit["intercept"] + fit["helling"] * np.arange(n)))
                for name, fit in national_trends.items()
                if fit
            },
            "locaties_multi_raw": pack_hist(multi),
            "categorie_raw": {k: pack_hist(sum(nat[key] for key in keys if key[1] == k)) for k in CATEGORIES},
            "groei_week_pct": [None if not np.isfinite(v) else round(100 * float(v), 3) for v in weekly_growth],
        },
        "scenarios": national_scen,
        "events": events_out,
        "carriers": sorted(carriers),
        "fits": {f"{k[0]}|{k[1]}": {kk: round(v, 5) if isinstance(v, float) else v for kk, v in f.items()} for k, f in zip(keys, fits)},
        "plafond_dichtheid_per_1000": {str(k): round(v, 3) for k, v in sorted(cap_density.items())},
        "regressies": {
            "totaal": rounded(total_trend),
            "locaties": rounded(national_trends["locaties"]),
            "categorie": {k: rounded(national_trends[k]) for k in CATEGORIES},
            "per_reeks": {
                f"{k[0]}|{k[1]}": rounded(log_trend(clean[k], int(np.flatnonzero(nat[k] > 0)[0]), T))
                for k in keys
            },
            "multi_vs_ratio": rounded(multi_fit),
        },
        "markt": {"helling_per_week": round(market["slope"], 5), "se": round(market["se"], 5), "multi_beta": round(multi_beta, 4)},
        "backtest": backtest,
        "methodology": methodology,
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    def write(path, payload):
        tmp = path.with_suffix(".json.tmp")
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, path)

    write(OUT_DIR / "national.json", national)

    # --- per gemeente files ---
    nat_q = {}
    for name, sc in SCENARIOS.items():
        so = scen_out[name]
        pm = sc["quantile"]
        nat_q[name] = {
            key: {p: q(so["paths"][i], v) - nat[key][T] for p, v in (("p10", 0.1), ("p50", pm), ("p90", 0.9))}
            for i, key in enumerate(keys)
        }
        # Sum of per-series quantiles is not the quantile of the sum; rescale so
        # the gemeenten add up to the national total at every quantile.
        for p, v in (("p10", 0.1), ("p50", pm), ("p90", 0.9)):
            target = q(so["totals"], v) - raw_total[T]
            summed = sum(nat_q[name][key][p] for key in keys)
            scale = np.where(np.abs(summed) > 1e-6, target / np.where(np.abs(summed) > 1e-6, summed, 1), 1.0)
            for key in keys:
                nat_q[name][key][p] = nat_q[name][key][p] * scale

    # Locaties per gemeente: punten / (own ratio x national ratio change), then
    # rescaled per week so gemeenten sum to the national locaties median.
    loc_ratio = {}
    for name, sc in SCENARIOS.items():
        so = scen_out[name]
        pm = sc["quantile"]
        p50 = np.tile(gem_total[:, T : T + 1], (1, H))
        for key in keys:
            dq = nat_q[name][key]["p50"]
            s50 = np.where(dq[None, :] >= 0, share[key]["post"][:, None], share[key]["cur"][:, None])
            p50 = p50 + s50 * dq[None, :]
        nat_ratio = q(so["totals"], pm) / np.maximum(q(so["loc"], pm), 1)
        ratio = gem_ratio_now[:, None] * (nat_ratio / ratio_hist[T])[None, :]
        raw_loc = p50 / np.maximum(ratio, 1e-6)
        scale = q(so["loc"], pm) / np.maximum(raw_loc.sum(axis=0), 1e-6)
        loc_ratio[name] = ratio / scale[None, :]  # punten per locatie per gemeente and week

    index_rows = []
    for g, slug in enumerate(gem_slugs):
        m = munis[slug]
        now_g = float(gem_total[g, T])
        g_scen = {}
        pi_width = None
        for name in SCENARIOS:
            per_key_p50 = {}
            tot = {p: np.zeros(H) for p in ("p10", "p50", "p90")}
            var = np.zeros(H)
            cat_tot = {k: {p: np.zeros(H) for p in ("p10", "p50", "p90")} for k in CATEGORIES}
            for key in keys:
                dq = nat_q[name][key]
                s_post, s_cur = share[key]["post"][g], share[key]["cur"][g]
                for p in tot:
                    s = np.where(dq[p] >= 0, s_post, s_cur)
                    add = s * dq[p]
                    tot[p] += add
                    cat_tot[key[1]][p] += add
                s50 = np.where(dq["p50"] >= 0, s_post, s_cur)
                var += dispersion * np.abs(dq["p50"]) * s50 * (1 - s50)
                per_key_p50[key] = gem_y[key][g, T] + s50 * dq["p50"]
            sd = np.sqrt(var)
            stock = {
                "p10": np.maximum(now_g + tot["p10"] - Z80 * sd, 0),
                "p50": now_g + tot["p50"],
                "p90": now_g + tot["p90"] + Z80 * sd,
            }
            cats = {}
            for k in CATEGORIES:
                hist_k = sum(gem_y[key][g] for key in keys if key[1] == k)
                kq = {p: np.maximum(hist_k[T] + cat_tot[k][p], 0) for p in cat_tot[k]}
                cats[k] = {"stock": pack_stock(hist_k, kq), "flow": pack_flow(np.r_[hist_k, kq["p50"]])}
            per_carrier = defaultdict(dict)
            for key, arr in per_key_p50.items():
                if gem_y[key][g].sum() == 0 and float(np.max(np.abs(arr))) < 0.5:
                    continue
                full = np.r_[gem_y[key][g], arr]
                per_carrier[key[0]][key[1]] = {gg: [r0(full[j]) for j in last_idx] for gg, (_, last_idx) in granularities.items() if gg != "week"}

            lq = {p: stock[p] / np.maximum(loc_ratio[name][g], 1.0) for p in stock}
            loc_now_g = max(gem_loc[g, T], 1)
            m_share_g = multi_share_at(
                gem_multi[g, T] / loc_now_g, now_g / loc_now_g, stock["p50"] / np.maximum(lq["p50"], 1)
            )
            mq = {p: m_share_g * lq[p] for p in lq}
            g_scen[name] = {
                "punten": {"stock": pack_stock(gem_total[g], stock), "flow": pack_flow(np.r_[gem_total[g], stock["p50"]])},
                "categorie": cats,
                "per_vervoerder": per_carrier,
                "locaties": {"stock": pack_stock(gem_loc[g], lq), "flow": pack_flow(np.r_[gem_loc[g], lq["p50"]])},
                "locaties_multi": {"stock": pack_stock(gem_multi[g], mq)},
                "_full": (np.r_[gem_total[g], stock["p50"]], np.r_[gem_total[g], stock["p10"]], np.r_[gem_total[g], stock["p90"]], np.r_[gem_loc[g], lq["p50"]]),
            }
            if name == "midden":
                p50_2030 = stock["p50"][-1]
                pi_width = float((stock["p90"][-1] - stock["p10"][-1]) / max(p50_2030, 1))

        # Reliability.
        adds_w = weekly_adds[g][weekly_ok[g]]
        weeks_clean = int(weekly_ok[g].sum())
        sd_w = float(np.std(adds_w)) if adds_w.size > 1 else 0.0
        mean_w = float(np.mean(adds_w)) if adds_w.size else 0.0
        noise_cv = sd_w / max(now_g, 1)
        snr = abs(mean_w) / (sd_w / math.sqrt(adds_w.size)) if sd_w > 0 and adds_w.size > 1 else 0.0
        # Own-data trend: cumulative organic additions against the week number.
        cum = np.cumsum(np.where(weekly_ok[g], weekly_adds[g], 0.0))
        own_trend = ols(np.arange(n, dtype=float)[weekly_ok[g]], cum[weekly_ok[g]])
        # Same anchoring as nationally: today's count minus the organic growth
        # still to come, so carrier intros do not show up as a jump.
        gem_clean = gem_total[g, T] - (cum[-1] - cum)
        gem_line = (
            gem_total[g, T] - cum[-1] + own_trend["intercept"] + own_trend["helling"] * np.arange(n)
            if own_trend
            else None
        )
        reasons = []
        if now_g < 15:
            reasons.append("minder dan 15 punten")
        if shrink_w[g] < 0.3:
            reasons.append("groei vooral geschat uit vergelijkbare gemeenten")
        if pi_width is not None and pi_width > 0.6:
            reasons.append("brede onzekerheidsband 2030")
        if bt_err_model[g] > 15:
            reasons.append("grote fout in terugtoets")
        if not reasons:
            level = "hoog"
        elif len(reasons) == 1 and now_g >= 15:
            level = "middel"
        else:
            level = "laag"
        reliability = {
            "n_now": r0(now_g),
            "weeks_clean": weeks_clean,
            "noise_cv": round(noise_cv, 4),
            "snr": round(snr, 2),
            "shrinkage_weight": round(float(shrink_w[g]), 3),
            "backtest_fout_pct": round(float(bt_err_model[g]), 2),
            "backtest_naief_pct": round(float(bt_err_naive[g]), 2),
            "pi_rel_width_2030": round(pi_width, 3) if pi_width is not None else None,
            "betrouwbaarheid": level,
            "redenen": reasons,
            "trend_eigen_data": rounded(own_trend, 4),
        }

        mid_full, _, _, mid_loc = g_scen["midden"]["_full"]
        head = headline(
            now_g, mid_full, g_scen["laag"]["_full"][0], g_scen["hoog"]["_full"][0], gem_loc[g, T], mid_loc
        )
        locker_now_g = float(sum(gem_y[k][g, T] for k in keys if k[1] == "locker"))
        head["aandeel_automaat_nu_pct"] = round(100 * locker_now_g / max(now_g, 1), 1)
        head["multi_aandeel_nu_pct"] = round(100 * gem_multi[g, T] / max(gem_loc[g, T], 1), 1)
        head["punten_per_locatie_nu"] = round(now_g / max(gem_loc[g, T], 1), 3)
        loc_2030 = end_of_year(mid_loc, HORIZON_YEAR)
        head["punten_per_locatie_2030"] = round(float(end_of_year(mid_full, HORIZON_YEAR)) / max(loc_2030, 1), 3)
        for name in g_scen:
            g_scen[name].pop("_full")

        info = gem_pop.get(slug, {})
        payload = {
            "generated_at": generated,
            "slug": slug,
            "naam": m.get("name"),
            "provincie": m.get("province"),
            "stedelijkheid": info.get("stedelijkheid"),
            "inwoners": info.get("inwoners"),
            "last_week": last_week,
            "periods": periods,
            "forecast_from": forecast_from,
            "headline": head,
            "reliability": reliability,
            "history": {
                "punten_raw": pack_hist(gem_total[g]),
                "punten_clean": pack_hist(gem_clean),
                **({"punten_trend_ols": pack_hist(gem_line)} if gem_line is not None else {}),
                "locaties_raw": pack_hist(gem_loc[g]),
                "locaties_multi_raw": pack_hist(gem_multi[g]),
                "categorie_raw": {k: pack_hist(sum(gem_y[key][g] for key in keys if key[1] == k)) for k in CATEGORIES},
            },
            "scenarios": g_scen,
        }
        write(OUT_DIR / f"{slug}.json", payload)
        index_rows.append({
            "slug": slug,
            "naam": m.get("name"),
            "provincie": m.get("province"),
            "stedelijkheid": info.get("stedelijkheid"),
            "inwoners": info.get("inwoners"),
            **head,
            "groei_2030": (head["y2030"] or 0) - (head["nu"] or 0),
            "groei_locaties_2030": (head["locaties_2030"] or 0) - (head["locaties_nu"] or 0),
            "betrouwbaarheid": reliability["betrouwbaarheid"],
            "shrinkage_weight": reliability["shrinkage_weight"],
            "backtest_fout_pct": reliability["backtest_fout_pct"],
            "pi_rel_width_2030": reliability["pi_rel_width_2030"],
        })

    write(OUT_DIR / "index.json", {"generated_at": generated, "last_week": last_week, "gemeenten": index_rows})

    # --- console summary and self-checks ---
    print(f"History {weeks[0]}..{last_week} ({n} weeks), forecast {future[0]}..{future[-1]} ({H} weeks)")
    print(f"Raw punten {raw_total[0]:.0f} -> {raw_total[T]:.0f}; cleaned start {clean_total[0]:.0f} (organic growth {100 * (clean_total[T] / clean_total[0] - 1):.1f}%)")
    print(f"Locaties {loc[0]:.0f} -> {loc[T]:.0f}; cleaned start {loc_clean[0]:.0f}")
    print(f"Detected/registered events: {len(events_out)}")
    for name in SCENARIOS:
        full = scen_full(name)
        print(f"  {name:6s} 2030: {end_of_year(full, HORIZON_YEAR):,.0f} punten")
    print(f"Headline: {nat_head}")
    print(f"Backtest: {backtest}")
    sum_g = sum(r["y2030"] for r in index_rows)
    print(f"Gemeenten sum 2030 (midden): {sum_g:,} vs national {nat_head['y2030']:,} ({100 * (sum_g / nat_head['y2030'] - 1):+.2f}%)")
    from collections import Counter
    print("Betrouwbaarheid:", Counter(r["betrouwbaarheid"] for r in index_rows))


if __name__ == "__main__":
    main()
