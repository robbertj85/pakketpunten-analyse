#!/usr/bin/env python3
"""
Sportlocaties Rotterdam: kaartdata + GIS-downloads voor /data-export/sportlocaties.

Bundelt een handmatige lijst sportcomplexen met de PC4-pijnpunten uit
pc4_painpoints.json (carriers en, zodra aangeleverd, de gemeente zelf) en de
bestaande pakketpunten van de gemeente Rotterdam.

Output (webapp/public/data/sportlocaties/):
  - sportlocaties_rotterdam.geojson    kaartdata voor de webapp-pagina
  - sportlocaties_rotterdam.gpkg       GeoPackage met alle lagen, stijlen
                                       ingebed (layer_styles), dus QGIS laat
                                       ze bij openen al goed zien
  - sportlocaties_rotterdam_qgis.zip   QGIS-project (.qgs) + GeoPackage,
                                       met OpenStreetMap-achtergrond

Coordinaten zijn eenmalig gegeocodeerd via PDOK Locatieserver (BAG-adres).
Spaanseweg 2-4 heeft geen huisnummer 2 in de BAG; nummer 4 is gebruikt.

Draai opnieuw wanneer de pijnpunten of de Rotterdamse pakketpunten wijzigen:
    python scripts/build_sportlocaties_export.py
"""

import json
import sqlite3
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from xml.sax.saxutils import escape

import geopandas as gpd
import pandas as pd
from shapely.geometry import MultiPolygon, Point, shape

ROOT = Path(__file__).resolve().parent.parent
WEBAPP_DATA = ROOT / "webapp" / "public" / "data"
OUT_DIR = WEBAPP_DATA / "sportlocaties"
CBS_PC4 = ROOT / "data" / "cbs" / "cbs_pc4_2024_v1.gpkg"
SLUG = "sportlocaties_rotterdam"
GEMEENTE = "Rotterdam"
RADII = (300, 400, 500)

SPORTLOCATIES = [
    ("Sportcomplex Neptunus Honkbal", "Abraham van Stolkweg 31, 3041 JA Rotterdam", 51.92367633, 4.43875737),
    ("Sportcomplex Victoria", "Kralingseweg 226, 3062 CG Rotterdam", 51.92981608, 4.53573994),
    ("Sportcomplex TC Rozenburg", "Koninginnelaan 26, 3181 GK Rozenburg", 51.9082662, 4.24696996),
    ("Sportcomplex RVV Blijdorp", "Noorderbocht 29, 3039 MA Rotterdam", 51.93782715, 4.45568201),
    ("Sportcomplex Olympia", "Buitendijk 100, 3078 XC Rotterdam", 51.88901305, 4.53079255),
    ("Sportcomplex Rkc Wion", "Max Planckplaats 300, 3068 ZH Rotterdam", 51.96000951, 4.53907709),
    ("Sportcentrum West", "Spaanseweg 2-4, 3028 HW Rotterdam", 51.91963845, 4.42919946),
    ("Sportcentrum Wilgenring", "Melanchtonweg 70, 3052 KV Rotterdam", 51.94887254, 4.47194597),
]

# Zelfde kleuren als lib/carriers.ts (CARRIER_SERIES_COLORS).
CARRIER_COLORS = {
    "PostNL": "#2a78d6", "DHL": "#eb6834", "DPD": "#1baf7a", "VintedGo": "#4a3aa7",
    "Amazon": "#eda100", "GLS": "#0e8f9e", "InPost": "#e34948", "Budbee": "#008300",
    "ViaTim": "#e87ba4", "DeBuren": "#a1541f", "FedEx": "#9b4dca",
}


# ---------------------------------------------------------------- data

def load_layers():
    geo = json.loads((WEBAPP_DATA / "rotterdam.geojson").read_text())
    punten, grens = [], None
    for f in geo["features"]:
        p = f["properties"]
        if p.get("type") == "pakketpunt":
            punten.append({
                "vervoerder": p.get("vervoerder"),
                "naam": p.get("locatieNaam") or "",
                "adres": " ".join(x for x in (p.get("straatNaam"), p.get("straatNr")) if x),
                "punt_type": p.get("puntType"),
                "geometry": shape(f["geometry"]),
            })
        elif p.get("type") == "boundary":
            grens = shape(f["geometry"])
    pakketpunten = gpd.GeoDataFrame(punten, crs="EPSG:4326")
    gemeentegrens = gpd.GeoDataFrame([{"gemeente": GEMEENTE, "geometry": grens}], crs="EPSG:4326")

    sport = gpd.GeoDataFrame(
        [{"nr": i + 1, "naam": n, "adres": a, "geometry": Point(lon, lat)}
         for i, (n, a, lat, lon) in enumerate(SPORTLOCATIES)],
        crs="EPSG:4326",
    )
    sport_rd = sport.to_crs(28992)
    pp_rd = pakketpunten.to_crs(28992)
    for r in RADII:
        sport[f"pakketpunten_{r}m"] = [
            int(pp_rd.geometry.within(g.buffer(r)).sum()) for g in sport_rd.geometry
        ]
    buffers = sport[["nr", "naam"]].copy()
    buffers = gpd.GeoDataFrame(buffers, geometry=sport_rd.geometry.buffer(400, 64), crs=28992).to_crs(4326)

    # PC4-pijnpunten: carriers (g4_city Rotterdam, dus ook randgemeenten die
    # carriers onder Rotterdam scharen) en de gemeente zelf.
    pain = json.loads((WEBAPP_DATA / "pc4_painpoints.json").read_text())
    rows = []
    for pc4, v in pain["painpoints"].items():
        carriers = v.get("carriers") or []
        gemeenten = v.get("gemeenten") or []
        if v.get("g4_city") != GEMEENTE and GEMEENTE not in gemeenten:
            continue
        rows.append({
            "pc4": pc4,
            "gemeente": v.get("municipality") or "",
            "carriers": ", ".join(carriers),
            "n_carriers": len(carriers),
            "door_gemeente": GEMEENTE in gemeenten,
            "toelichting": "; ".join(v.get("notes") or []),
            "pakketpunten": (v.get("pakketpunten") or {}).get("total", 0),
        })
    pain_df = pd.DataFrame(rows)

    if CBS_PC4.exists():
        pc4 = gpd.read_file(CBS_PC4, columns=["postcode"]).rename(columns={"postcode": "pc4"})
        pc4["pc4"] = pc4["pc4"].astype(str)
        pc4 = pc4.to_crs(4326)
    else:
        pc4 = gpd.read_file(WEBAPP_DATA / "pc4.geojson")[["pc4", "geometry"]]
    pain_gdf = pc4.merge(pain_df, on="pc4", how="inner")
    carriers_gdf = pain_gdf[pain_gdf["n_carriers"] > 0].reset_index(drop=True)
    gemeente_gdf = pain_gdf[pain_gdf["door_gemeente"]].reset_index(drop=True)

    # Welke sportlocatie ligt in een pijnpunt-PC4?
    def pc4_of(pt):
        hit = pain_gdf[pain_gdf.contains(pt)]
        return hit.iloc[0]["pc4"] if len(hit) else None
    sport["pc4_pijnpunt"] = [pc4_of(g) for g in sport.geometry]

    return {
        "sportlocaties": sport,
        "sportlocaties_400m": buffers,
        "pijnpunten_carriers": carriers_gdf,
        "pijnpunten_gemeente": gemeente_gdf,
        "pakketpunten": pakketpunten,
        "gemeentegrens": gemeentegrens,
    }, pain["gemeente_status"].get(GEMEENTE)


# ---------------------------------------------------------------- QGIS-stijlen

def rgba(hex_color, alpha=255):
    h = hex_color.lstrip("#")
    return f"{int(h[0:2], 16)},{int(h[2:4], 16)},{int(h[4:6], 16)},{alpha}"


def opts(d):
    return "".join(f'<Option name="{k}" type="QString" value="{escape(str(v))}"/>' for k, v in d.items())


def marker_symbol(name, color, size, outline="#ffffff", shape_name="circle"):
    return (
        f'<symbol type="marker" name="{name}" alpha="1" clip_to_extent="1" force_rhr="0">'
        f'<layer class="SimpleMarker" enabled="1" pass="0" locked="0"><Option type="Map">'
        + opts({"color": rgba(color), "name": shape_name, "outline_color": rgba(outline),
                "outline_style": "solid", "outline_width": "0.4", "size": size, "size_unit": "MM"})
        + "</Option></layer></symbol>"
    )


def fill_symbol(name, color, fill_alpha, outline, outline_width="0.5", outline_style="solid"):
    return (
        f'<symbol type="fill" name="{name}" alpha="1" clip_to_extent="1" force_rhr="0">'
        f'<layer class="SimpleFill" enabled="1" pass="0" locked="0"><Option type="Map">'
        + opts({"color": rgba(color, fill_alpha), "style": "solid" if fill_alpha else "no",
                "outline_color": rgba(outline), "outline_style": outline_style,
                "outline_width": outline_width, "outline_width_unit": "MM"})
        + "</Option></layer></symbol>"
    )


def single(symbol):
    return f'<renderer-v2 type="singleSymbol" symbollevels="0" enableorderby="0" forceraster="0"><symbols>{symbol}</symbols></renderer-v2>'


def labeling(field, size=9):
    return (
        '<labeling type="simple"><settings calloutType="simple">'
        f'<text-style fieldName="{field}" fontSize="{size}" fontWeight="75" textColor="20,20,20,255" fontSizeUnit="Point">'
        '<text-buffer bufferDraw="1" bufferSize="1" bufferSizeUnits="MM" bufferColor="255,255,255,255" bufferOpacity="1"/>'
        "</text-style>"
        '<placement placement="6" dist="2" distUnits="MM" quadOffset="2"/>'
        '<rendering scaleVisibility="0" obstacle="1" drawLabels="1"/>'
        "</settings></labeling>"
    )


def renderers(pakketpunten):
    carriers = sorted(set(pakketpunten["vervoerder"].dropna()))
    cats = "".join(f'<category render="true" symbol="{i}" value="{escape(c)}" label="{escape(c)}"/>'
                   for i, c in enumerate(carriers))
    syms = "".join(marker_symbol(str(i), CARRIER_COLORS.get(c, "#9ca3af"), "1.8")
                   for i, c in enumerate(carriers))
    categorized = (
        '<renderer-v2 type="categorizedSymbol" attr="vervoerder" symbollevels="0" enableorderby="0" forceraster="0">'
        f"<categories>{cats}</categories><symbols>{syms}</symbols></renderer-v2>"
    )
    return {
        "sportlocaties": (single(marker_symbol("0", "#c2410c", "5", "#ffffff", "star")), labeling("naam")),
        "sportlocaties_400m": (single(fill_symbol("0", "#c2410c", 25, "#c2410c", "0.4", "dash")), ""),
        "pijnpunten_carriers": (single(fill_symbol("0", "#dc2626", 70, "#b91c1c", "0.5")), labeling("pc4", 8)),
        "pijnpunten_gemeente": (single(fill_symbol("0", "#7c3aed", 0, "#7c3aed", "1.2")), ""),
        "pakketpunten": (categorized, ""),
        "gemeentegrens": (single(fill_symbol("0", "#000000", 0, "#374151", "0.6", "dash")), ""),
    }


def qml(renderer, label):
    enabled = "1" if label else "0"
    return (
        "<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>"
        f'<qgis version="3.34.0" styleCategories="Symbology|Labeling" labelsEnabled="{enabled}">'
        f"{renderer}{label}</qgis>"
    )


# ---------------------------------------------------------------- export

LAYER_TITLES = {
    "sportlocaties": "Sportlocaties",
    "sportlocaties_400m": "Sportlocaties - 400 m loopafstand",
    "pijnpunten_carriers": "Pijnpunten carriers (PC4)",
    "pijnpunten_gemeente": "Pijnpunten gemeente (PC4)",
    "pakketpunten": "Bestaande pakketpunten",
    "gemeentegrens": "Gemeentegrens Rotterdam",
}
GEOM_TYPES = {
    "sportlocaties": "Point", "sportlocaties_400m": "Polygon",
    "pijnpunten_carriers": "MultiPolygon", "pijnpunten_gemeente": "MultiPolygon",
    "pakketpunten": "Point", "gemeentegrens": "Polygon",
}


def write_gpkg(layers, styles, path):
    path.unlink(missing_ok=True)
    for name, gdf in layers.items():
        gdf = gdf.copy()
        if GEOM_TYPES[name] == "MultiPolygon":
            gdf.geometry = gdf.geometry.apply(
                lambda g: g if g.geom_type == "MultiPolygon" else MultiPolygon([g]))
        # Lege laag (bijv. nog geen gemeente-pijnpunten) toch met schema wegschrijven.
        gdf.to_file(path, layer=name, driver="GPKG", engine="pyogrio",
                    geometry_type=GEOM_TYPES[name], layer_options={"IDENTIFIER": LAYER_TITLES[name]})

    con = sqlite3.connect(path)
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS layer_styles (
          id INTEGER PRIMARY KEY AUTOINCREMENT, f_table_catalog TEXT, f_table_schema TEXT,
          f_table_name TEXT, f_geometry_column TEXT, styleName TEXT, styleQML TEXT,
          styleSLD TEXT, useAsDefault BOOLEAN, description TEXT, owner TEXT, ui TEXT,
          update_time DATETIME DEFAULT CURRENT_TIMESTAMP);
        INSERT OR IGNORE INTO gpkg_contents (table_name, data_type, identifier)
          VALUES ('layer_styles', 'attributes', 'layer_styles');
        """
    )
    for name, (renderer, label) in styles.items():
        con.execute(
            "INSERT INTO layer_styles (f_table_catalog, f_table_schema, f_table_name, f_geometry_column,"
            " styleName, styleQML, styleSLD, useAsDefault, description, owner)"
            " VALUES ('', '', ?, 'geometry', ?, ?, '', 1, 'Pakketpunten-analyse', '')",
            (name, name, qml(renderer, label)),
        )
    con.commit()
    con.close()


def write_qgs(layers, styles, gpkg_name):
    # Tekenvolgorde: bovenste item in de lagenlijst wordt bovenop getekend.
    order = ["sportlocaties", "pakketpunten", "sportlocaties_400m",
             "pijnpunten_gemeente", "pijnpunten_carriers", "gemeentegrens"]
    xmin, ymin, xmax, ymax = layers["gemeentegrens"].to_crs(3857).total_bounds
    srs = lambda code: f"<spatialrefsys><authid>EPSG:{code}</authid></spatialrefsys>"

    tree = "".join(
        f'<layer-tree-layer id="{n}" name="{escape(LAYER_TITLES[n])}" '
        f'source="./{gpkg_name}|layername={n}" providerKey="ogr" checked="Qt::Checked" expanded="1"><customproperties/></layer-tree-layer>'
        for n in order
    ) + ('<layer-tree-layer id="osm" name="OpenStreetMap" source="" providerKey="wms" '
         'checked="Qt::Checked" expanded="0"><customproperties/></layer-tree-layer>')

    maplayers = ""
    for n in order:
        renderer, label = styles[n]
        geom = "Point" if GEOM_TYPES[n] == "Point" else "Polygon"
        maplayers += (
            f'<maplayer type="vector" geometry="{geom}" labelsEnabled="{1 if label else 0}" autoRefreshEnabled="0">'
            f"<id>{n}</id><datasource>./{gpkg_name}|layername={n}</datasource>"
            f"<layername>{escape(LAYER_TITLES[n])}</layername><srs>{srs(4326)}</srs>"
            f'<provider encoding="UTF-8">ogr</provider>{renderer}{label}</maplayer>'
        )
    maplayers += (
        '<maplayer type="raster" autoRefreshEnabled="0"><id>osm</id>'
        "<datasource>type=xyz&amp;url=https://tile.openstreetmap.org/%7Bz%7D/%7Bx%7D/%7By%7D.png&amp;zmax=19&amp;zmin=0</datasource>"
        f"<layername>OpenStreetMap</layername><srs>{srs(3857)}</srs><provider>wms</provider></maplayer>"
    )

    return (
        "<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>\n"
        '<qgis projectname="Sportlocaties Rotterdam" version="3.34.0">'
        "<title>Sportlocaties Rotterdam</title>"
        f"<projectCrs>{srs(3857)}</projectCrs>"
        f"<layer-tree-group><customproperties/>{tree}</layer-tree-group>"
        '<mapcanvas name="theMapCanvas" annotationsVisible="1"><units>meters</units>'
        f"<extent><xmin>{xmin}</xmin><ymin>{ymin}</ymin><xmax>{xmax}</xmax><ymax>{ymax}</ymax></extent>"
        f"<rotation>0</rotation><destinationsrs>{srs(3857)}</destinationsrs></mapcanvas>"
        f"<projectlayers>{maplayers}</projectlayers>"
        '<properties><Paths><Absolute type="bool">false</Absolute></Paths></properties>'
        "</qgis>\n"
    )


def write_web_geojson(layers, gemeente_status, path):
    feats = []

    def add(gdf, kind, simplify=None):
        g = gdf if simplify is None else gdf.assign(
            geometry=gdf.to_crs(28992).geometry.simplify(simplify).to_crs(4326))
        for rec in json.loads(g.to_json(drop_id=True))["features"]:
            rec["properties"]["laag"] = kind
            feats.append(rec)

    add(layers["sportlocaties"], "sportlocatie")
    add(layers["pijnpunten_carriers"], "pijnpunt_carriers", simplify=5)
    add(layers["pijnpunten_gemeente"], "pijnpunt_gemeente", simplify=5)
    out = {
        "type": "FeatureCollection",
        "metadata": {
            "gemeente": GEMEENTE,
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "gemeente_status": gemeente_status,
            "downloads": {
                "gpkg": f"/data/sportlocaties/{SLUG}.gpkg",
                "qgis": f"/data/sportlocaties/{SLUG}_qgis.zip",
            },
        },
        "features": feats,
    }
    path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    layers, gemeente_status = load_layers()
    styles = renderers(layers["pakketpunten"])

    gpkg = OUT_DIR / f"{SLUG}.gpkg"
    write_gpkg(layers, styles, gpkg)

    qgs = write_qgs(layers, styles, gpkg.name)
    with zipfile.ZipFile(OUT_DIR / f"{SLUG}_qgis.zip", "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(f"{SLUG}.qgs", qgs)
        z.write(gpkg, gpkg.name)

    write_web_geojson(layers, gemeente_status, OUT_DIR / f"{SLUG}.geojson")

    for name, gdf in layers.items():
        print(f"  {name:22s} {len(gdf):4d}")
    print(f"Gemeente-status pijnpunten: {gemeente_status}")
    print(f"Klaar -> {OUT_DIR.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
