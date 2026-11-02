"""
Parcel demand per inhabitant from the ACM Post- en Pakketmonitor.

One place for the numbers every tool uses: the forecast (scripts/forecast_growth.py)
and the Netwerkplanner capacity model (scripts/plan_locker_network.py). Inputs are
data/acm_parcel_volume.json and the CBS population in
data/cbs/gemeente_population_forecast.json.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ACM = ROOT / "data" / "acm_parcel_volume.json"
POPULATION = ROOT / "data" / "cbs" / "gemeente_population_forecast.json"


def latest(series: dict):
    year = max(series)
    return int(year), series[year]


def parcels_per_inhabitant(acm: dict | None = None, pop: dict | None = None) -> dict:
    """
    Parcels per inhabitant per year in the latest ACM year: all parcels, consumer
    (B2C) parcels, and parcels collected out of home (servicepunt or kluis).

    ACM's afhaal-aandeel is over all parcels. Business parcels are rarely
    collected, so as a share of consumer parcels it is higher; that is the
    share comparable to the Netwerkplanner slider, which applies to consumer
    parcels.
    """
    acm = acm or json.loads(ACM.read_text(encoding="utf-8"))
    pop = pop or json.loads(POPULATION.read_text(encoding="utf-8"))
    year, volume = latest(acm["volume_mln"])
    _, b2c = latest(acm["b2c_share"])
    _, ooh = latest(acm["ooh_share"])
    # CBS inhabitants now, moved to the ACM year along the national index.
    inhabitants = sum(g["inwoners"] for g in pop["gemeenten"].values() if g.get("inwoners"))
    index = pop.get("national_index") or {}
    inhabitants *= index.get(str(year), 1.0)
    total = volume * 1e6 / inhabitants
    return {
        "jaar": year,
        "inwoners_mln": round(inhabitants / 1e6, 2),
        "pakketten_mln": volume,
        "totaal": round(total, 1),
        "consument": round(total * b2c, 1),
        "afgehaald": round(total * ooh, 1),
        "b2c_aandeel": b2c,
        "afhaal_aandeel": ooh,
        "afhaal_aandeel_consument": round(ooh / b2c, 3),
    }


if __name__ == "__main__":
    print(parcels_per_inhabitant())
