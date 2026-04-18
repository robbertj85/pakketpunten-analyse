"""Build a short PDF brief for municipalities summarising what we know
about where parcel points belong and which features predict their
density at PC4 level.

Inputs (all produced by earlier scripts):

  - output/best_model_report.json                 (best-subset leaderboard)
  - output/handelingsperspectief/g4_analysis.json (per-city fits)
  - output/handelingsperspectief/coefficients_per_region.png
  - output/handelingsperspectief/r2_per_region.png
  - output/handelingsperspectief/ui_scatter.png   (browser screenshot)
  - output/handelingsperspectief/ui_table.png     (browser screenshot)

Output:

  - output/handelingsperspectief/handelingsperspectief_pakketpunten.pdf
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
)
from reportlab.lib.enums import TA_LEFT

ROOT = Path(__file__).parent.parent
OUT_DIR = ROOT / "output" / "handelingsperspectief"
PDF_PATH = OUT_DIR / "handelingsperspectief_pakketpunten.pdf"

BEST_MODEL_JSON = ROOT / "output" / "best_model_report.json"
G4_JSON = OUT_DIR / "g4_analysis.json"


def _style():
    s = getSampleStyleSheet()
    s.add(ParagraphStyle(name="H0", parent=s["Title"], fontSize=20, spaceAfter=6,
                         alignment=TA_LEFT, textColor=colors.HexColor("#111827")))
    s.add(ParagraphStyle(name="H1", parent=s["Heading1"], fontSize=14,
                         spaceBefore=14, spaceAfter=6,
                         textColor=colors.HexColor("#1f2937")))
    s.add(ParagraphStyle(name="H2", parent=s["Heading2"], fontSize=11,
                         spaceBefore=10, spaceAfter=3,
                         textColor=colors.HexColor("#374151")))
    s.add(ParagraphStyle(name="Body2", parent=s["BodyText"], fontSize=9.5,
                         leading=13, spaceAfter=6))
    s.add(ParagraphStyle(name="Caption", parent=s["BodyText"], fontSize=8,
                         leading=10, textColor=colors.HexColor("#6b7280"),
                         spaceAfter=8))
    s.add(ParagraphStyle(name="Takeaway", parent=s["BodyText"], fontSize=10,
                         leading=13, spaceAfter=6,
                         backColor=colors.HexColor("#eef2ff"),
                         borderColor=colors.HexColor("#c7d2fe"),
                         borderWidth=0.5, borderPadding=6, leftIndent=0))
    return s


def _picture(path: Path, width_cm: float, caption: str | None = None,
             styles=None, max_height_cm: float = 20.0) -> list:
    """Load an image and scale proportionally to fit within (width × max_height)."""
    if not path.exists():
        return [Paragraph(f"<i>(Afbeelding ontbreekt: {path.name})</i>",
                          styles["Caption"])]
    from reportlab.lib.utils import ImageReader
    iw, ih = ImageReader(str(path)).getSize()
    w = width_cm * cm
    h = w * ih / iw
    if h > max_height_cm * cm:
        h = max_height_cm * cm
        w = h * iw / ih
    items = [Image(str(path), width=w, height=h)]
    if caption:
        items.append(Paragraph(caption, styles["Caption"]))
    return items


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    styles = _style()

    # ---- Load data ----
    with open(BEST_MODEL_JSON) as f:
        best = json.load(f)
    with open(G4_JSON) as f:
        g4 = json.load(f)

    # Best-at-k leaderboard (top 1 per k, for sizes 2..8)
    top_per_k = [(int(k), v[0]) for k, v in sorted(best["best_per_k"].items(),
                                                   key=lambda x: int(x[0]))]
    # Step comparisons (from scripts/find_best_model.py)
    steps = best.get("step_comparisons", [])
    # G4 fits
    fits = g4["fits"]
    feat_keys = g4["features"]
    feat_labels = g4["labels"]

    story: list = []

    # ---------- Cover / exec summary ----------
    story.append(Paragraph("Schatting en plaatsing van pakketpunten", styles["H0"]))
    story.append(Paragraph(
        "Handelingsperspectief voor gemeentes — modelfit op PC4-niveau",
        styles["H2"],
    ))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        "Analyse van ~4 000 Nederlandse postcodegebieden op basis van 25 "
        "variabelen (demografie, inkomen, stedelijkheid, voorzieningen, "
        "verkeer en OV). Deze notitie vat samen welke factoren de locatie "
        "van pakketpunten het beste voorspellen, en hoe de G4-steden "
        "afwijken van de rest van Nederland.",
        styles["Body2"],
    ))

    story.append(Paragraph("Kern bevinding", styles["H1"]))
    story.append(Paragraph(
        "De sterkste voorspellers voor pakketpunten-dichtheid per PC4 zijn "
        "<b>inwoners, grote supermarkten binnen 1 km, horeca binnen 1 km, "
        "en OV-haltes in het gebied</b> — gemoduleerd door inkomensniveau "
        "en stedelijkheidsgraad. Dit 6-variabelenmodel verklaart "
        "~54&nbsp;% van de variantie in pakketpuntentellingen, en wordt "
        "zowel door de elbow-regel als het laagste BIC als optimum gekozen.",
        styles["Takeaway"],
    ))

    # ---------- Wat werkt? (best model table) ----------
    story.append(Paragraph("Het beste 6-variabelenmodel", styles["H1"]))
    story.append(Paragraph(
        "Exhaustieve best-subset zoektocht over alle 262 143 variabele-"
        "combinaties (tot grootte 8) wijst consistent hetzelfde optimum aan. "
        "De stapsgewijze R²-winst per extra variabele (kolom ΔR²) laat zien "
        "waarom k=6 de sweet spot is: daarna zakt Cohen's f² onder 0.02 — "
        "statistisch nog significant, maar praktisch verwaarloosbaar.",
        styles["Body2"],
    ))

    # Build a table: size, features, R², ΔR² vs prev
    tbl_rows = [["k", "R²", "BIC", "Beste feature-set"]]
    for k, mdl in top_per_k:
        tbl_rows.append([
            str(k),
            f"{mdl['r2']:.3f}",
            f"{mdl['bic']:.0f}",
            Paragraph(" + ".join(mdl["labels"]), styles["Caption"]),
        ])
    tbl = Table(tbl_rows, colWidths=[1 * cm, 1.4 * cm, 1.8 * cm, 12 * cm])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#111827")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("ALIGN", (0, 0), (2, -1), "CENTER"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1),
            [colors.whitesmoke, colors.HexColor("#eef2ff")]),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#d1d5db")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(tbl)
    story.append(Paragraph(
        "Tabel 1. Beste feature-combinatie per model-grootte k. "
        "Elbow-regel (ΔR² < 0.003) en laagste BIC kiezen beide k = 6.",
        styles["Caption"],
    ))

    # Step statistics
    if steps:
        step_rows = [["Stap", "ΔR²", "Cohen's f²", "Effect", "ΔBIC"]]
        for s in steps:
            step_rows.append([
                f"{s['from_k']}→{s['to_k']}",
                f"{s['delta_r2']:+.4f}",
                f"{s['cohens_f2']:.3f}",
                s["cohens_f2_label"],
                f"{s['delta_bic']:+.1f}",
            ])
        tbl2 = Table(step_rows, colWidths=[1.6 * cm, 2 * cm, 2 * cm, 3 * cm, 2 * cm])
        tbl2.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#111827")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#d1d5db")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1),
                [colors.whitesmoke, colors.HexColor("#fefce8")]),
        ]))
        story.append(Spacer(1, 6))
        story.append(tbl2)
        story.append(Paragraph(
            "Tabel 2. Incrementele waarde per toegevoegde variabele. Vanaf "
            "stap 5→6 daalt Cohen's f² onder 0.02 (verwaarloosbaar effect).",
            styles["Caption"],
        ))

    story.append(PageBreak())

    # ---------- Scatter screenshot ----------
    story.append(Paragraph("Model in actie", styles["H1"]))
    story.append(Paragraph(
        "De webapp <code>/data-export/schatting</code> laat het model live "
        "herberekenen. In de scatterplot toont de stippellijn (indigo) het "
        "huidige model; de doorgetrokken lijn (oranje) de basis van alleen "
        "inwoners en oppervlakte.",
        styles["Body2"],
    ))
    story += _picture(OUT_DIR / "ui_scatter.png", 17, styles=styles,
                      caption="Figuur 1. Scatterplot van inwoners vs. pakketpunten per PC4. "
                              "Pijnpunten (rood) liggen systematisch onder de trendlijn.")

    story.append(Paragraph("Regressievergelijking en coëfficiënten", styles["H2"]))
    story += _picture(OUT_DIR / "ui_table.png", 17, styles=styles,
                      caption="Figuur 2. Coëfficiëntentabel voor het k=6 model (incl. "
                              "VIF voor multicollineariteit en leave-one-out Drop-F).")

    story.append(PageBreak())

    # ---------- G4 comparison ----------
    story.append(Paragraph("G4 vs. rest van Nederland", styles["H1"]))
    story.append(Paragraph(
        "Hetzelfde 6-variabelenmodel gefit per stad en voor 'rest van NL'. "
        "De steden verschillen sterk in welke factoren bijdragen. Let op: "
        "G4-modellen hebben weinig observaties (40–80 PC4s), dus "
        "coëfficiënten zijn hier voorzichtiger te interpreteren.",
        styles["Body2"],
    ))

    story += _picture(OUT_DIR / "r2_per_region.png", 16, styles=styles,
                      caption="Figuur 3. Modelfit per regio. Utrecht heeft de zwakste fit (R² 0.24) — "
                              "mogelijk door kleine steekproef en afwijkende structuur.")
    story += _picture(OUT_DIR / "coefficients_per_region.png", 17, styles=styles,
                      caption="Figuur 4. Regressie-coëfficiënten per variabele, per regio.")

    # Table with coefs per region
    g4_rows = [["Regio", "n", "R²"] + [feat_labels[k] for k in feat_keys]]
    for region, fit in fits.items():
        if "error" in fit:
            continue
        coefs = fit["coefficients"]
        g4_rows.append([
            region,
            str(fit["n"]),
            f"{fit['r2']:.3f}",
            *[
                f"{coefs[k]:.2e}" if abs(coefs[k]) < 0.01 else f"{coefs[k]:.3f}"
                for k in feat_keys
            ],
        ])
    g4_tbl = Table(g4_rows, repeatRows=1)
    g4_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#111827")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 7.5),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#d1d5db")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1),
            [colors.whitesmoke, colors.HexColor("#eef2ff")]),
    ]))
    story.append(g4_tbl)
    story.append(Paragraph(
        "Tabel 3. Coëfficiëntvergelijking: zelfde model, verschillende fit per regio.",
        styles["Caption"],
    ))

    story.append(PageBreak())

    # ---------- Handelingsperspectief ----------
    story.append(Paragraph("Handelingsperspectief voor gemeentes", styles["H1"]))
    story.append(Paragraph(
        "De coëfficiënten geven per extra eenheid van een variabele de "
        "verwachte toename in pakketpunten. Omgerekend naar beleidstaal:",
        styles["Body2"],
    ))

    def bullet(text: str):
        return Paragraph("• " + text, styles["Body2"])

    story.append(Paragraph("Waar werken pakketpunten goed?", styles["H2"]))
    story.append(bullet(
        "<b>Rond grote supermarkten</b> — één extra supermarkt binnen 1 km "
        "geeft buiten de G4 gemiddeld +1,1 pakketpunt. In G4-steden is het "
        "effect zwakker (+0,4 à +0,5) omdat supermarktdichtheid al hoog is."
    ))
    story.append(bullet(
        "<b>In horeca-clusters</b> — cafés, cafetaria's en restaurants "
        "zijn logische hosts. Rest van NL: +0,08 per vestiging binnen 1 km. "
        "In Utrecht én Amsterdam verdwijnt dit effect (verzadigde retail-mix)."
    ))
    story.append(bullet(
        "<b>Bij OV-haltes</b> — per halte krijg je +0,07 pakketpunt extra, "
        "consistent in alle G4-steden. Pakketautomaten clusteren rond "
        "stations en centrale haltes."
    ))
    story.append(bullet(
        "<b>In buurten met lager inkomen</b> — +0,08 pakketpunt per procentpunt "
        "huishoudens met laag inkomen. Gebruikersgroep: Vinted, tweedehands, "
        "shops i.p.v. thuisbezorging."
    ))
    story.append(bullet(
        "<b>In dichtbevolkte postcodes</b> — +0,68 pakketpunt per 1 000 inwoners. "
        "Is de basislijn, maar redt niet alleen het model: dichtheid zonder "
        "retail (OAD met negatieve coëfficiënt) voorspelt juist minder punten."
    ))

    story.append(Paragraph("Waar werken pakketpunten matig?", styles["H2"]))
    story.append(bullet(
        "<b>In louter residentiële hoogbouw</b> — hoge omgevingsadressen-"
        "dichtheid (OAD) zonder horeca/winkels krijgt een <i>negatieve</i> "
        "coëfficiënt bij controle voor andere factoren."
    ))
    story.append(bullet(
        "<b>In landelijke, welvarende PC4s</b> — thuisbezorging domineert, "
        "weinig pakketpunt-traffic."
    ))

    story.append(Paragraph("Let op bij per-stad-beleid", styles["H2"]))
    story.append(bullet(
        "<b>Amsterdam / Rotterdam</b>: supermarktcoëfficiënt ~2× kleiner dan "
        "landelijk. Marginale opbrengst van nog meer pakketpunten bij reeds "
        "verzadigde supermarkten is beperkt — zoek liever ondergebruikte "
        "OV-locaties."
    ))
    story.append(bullet(
        "<b>Den Haag</b>: supermarktcoëfficiënt is <i>negatief</i>. Mogelijke "
        "interpretatie: veel supermarkten in wijken met al hoge PP-dekking, "
        "nieuwe locaties zullen zich richten op onderbediende OV-knooppunten "
        "en lage-inkomens-buurten (sterkste positieve coëfficiënten daar)."
    ))
    story.append(bullet(
        "<b>Utrecht</b>: R² slechts 0,24 — model verklaart weinig. Kleine "
        "dataset (42 PC4s) speelt mee, maar Utrecht's functiemenging lijkt "
        "meer gedreven door factoren buiten dit model (studenten, ZE-zone)."
    ))

    story.append(Paragraph("Aanbevolen werkwijze", styles["H2"]))
    story.append(bullet(
        "1. Gebruik de scatter-visualisatie op <font face='Courier'>/data-export/schatting</font> "
        "om PC4s te vinden met een negatieve residu (minder pakketpunten dan "
        "voorspeld op basis van inwoners, horeca, supermarkten, OV-dichtheid). "
        "Dat zijn plekken waar extra capaciteit het verschil maakt."
    ))
    story.append(bullet(
        "2. Combineer met de pijnpuntenlijst van vervoerders (tab 'Pijnpunten') — "
        "plekken die zowel 'te weinig op basis van variabelen' ALS 'door "
        "vervoerders gerapporteerd' zijn, zijn prioriteit."
    ))
    story.append(bullet(
        "3. Kies locaties dichtbij voorzieningen: supermarkt, OV-halte, horeca. "
        "Vermijd louter residentiële hoogbouw."
    ))

    # ---------- Methodology appendix ----------
    story.append(PageBreak())
    story.append(Paragraph("Appendix: methodologie & bronnen", styles["H1"]))
    story.append(Paragraph(
        "<b>Model:</b> OLS-regressie op PC4-niveau, afhankelijke variabele = "
        "aantal pakketpunten (totaal over alle carriers). Inclusie-criteria: "
        "PC4 met ≥ 10 inwoners en ≥ 0,05 km². Cases met ontbrekende features "
        "worden uitgesloten (complete-case).",
        styles["Body2"],
    ))
    story.append(Paragraph(
        "<b>Best-subset search:</b> <code>scripts/find_best_model.py</code> "
        "evalueert exhaustief alle subsets tot k=8 (262 143 fits) via "
        "numpy.linalg.lstsq. Ranking op R², BIC en elbow-regel. Stapsgewijze "
        "F-toets + Cohen's f² meten of een extra variabele praktisch bijdraagt.",
        styles["Body2"],
    ))
    story.append(Paragraph(
        "<b>Databronnen (alle open data):</b>",
        styles["Body2"],
    ))
    sources = [
        ("Pakketpunten", "Eigen scraping + API's van DHL, PostNL, DPD, VintedGo, "
                         "Amazon (OSM), DeBuren, GLS, ViaTim, InPost, Budbee"),
        ("PC4-polygonen", "CBS Kerncijfers per postcode 2022 (vol)"),
        ("Demografie & inkomen", "CBS 83502NED (inwoners), CBS Kerncijfers PC4 "
                                 "2022 (inkomen, WOZ, stedelijkheid, horeca 1 km)"),
        ("SES-WOA", "CBS maatwerk 2024/24 (sociaal-economische status per PC4, "
                    "incl. studentenhuishoudens)"),
        ("Laad-/losplaatsen", "NDW verkeersborden (RVV-code E7, dagelijks)"),
        ("Milieu-/ZE-zones", "NDW emissiezones (DATEX II)"),
        ("OV-haltes", "OVapi GTFS feed (nationaal, alle carriers)"),
    ]
    # Wrap the bron text in a Paragraph so it word-wraps inside the cell
    src_rows = [["Variabele", "Bron"]] + [
        [k, Paragraph(v, styles["Body2"])] for k, v in sources
    ]
    src_tbl = Table(src_rows, colWidths=[4 * cm, 12 * cm])
    src_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#111827")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#d1d5db")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1),
            [colors.whitesmoke, colors.HexColor("#eef2ff")]),
    ]))
    story.append(src_tbl)

    story.append(Spacer(1, 10))
    story.append(Paragraph(
        "<b>Reproduceerbaarheid:</b> alle fetch-scripts staan onder "
        "<font face='Courier'>scripts/fetch_*</font>. Na "
        "<font face='Courier'>scripts/build_pc4_stats.py</font> en "
        "<font face='Courier'>scripts/fit_pc4_model.py</font> is de webapp "
        "up-to-date. De leaderboard "
        "(<font face='Courier'>output/best_model_report.txt</font>) en deze "
        "PDF komen uit "
        "<font face='Courier'>scripts/generate_handelingsperspectief_pdf.py</font>.",
        styles["Body2"],
    ))

    # ---- Render ----
    doc = SimpleDocTemplate(
        str(PDF_PATH),
        pagesize=A4,
        leftMargin=1.8 * cm, rightMargin=1.8 * cm,
        topMargin=1.6 * cm, bottomMargin=1.8 * cm,
        title="Schatting pakketpunten — handelingsperspectief",
    )
    doc.build(story)
    print(f"✓ PDF → {PDF_PATH}  ({PDF_PATH.stat().st_size / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
