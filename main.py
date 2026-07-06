from api_client import get_data_pakketpunten
from geo_analysis import get_bufferzones
from visualize import create_map
from utils import save_output, get_gemeente_polygon
import argparse
import sys

def main(gemeente, filename, format):
    # Laad geodataframe met alle gevonden pakketpunten
    gdf_pakketpunten = get_data_pakketpunten(gemeente)

    # Voeg een extra kolom toe met placeholder data voor bezettingsgraad (vast op 50)
    gdf_pakketpunten["bezettingsgraad"] = 50

    # voeg een buffer met radius van 300 en 400 meter rondom de pakketpunten toe
    gdf_buffers300, gdf_bufferunion300 = get_bufferzones(gdf_pakketpunten, radius=300)
    gdf_buffers400, gdf_bufferunion400 = get_bufferzones(gdf_pakketpunten, radius=400)

    # Haal gemeentegrens op
    try:
        gdf_boundary = get_gemeente_polygon(gemeente)
        print(f"  🗺️  Gemeentegrens opgehaald voor '{gemeente}'")
    except Exception as e:
        print(f"  ⚠️  Kon gemeentegrens niet ophalen: {e}")
        gdf_boundary = None

    # Dekkingsgraad-lagen komen uit get_bufferzones() in RD (EPSG:28992);
    # converteer naar WGS84 zodat de GeoJSON-output geldig is (RFC 7946)
    gdf_buffers300 = gdf_buffers300.to_crs(epsg=4326)
    gdf_buffers400 = gdf_buffers400.to_crs(epsg=4326)

    # data opslaan als geopackage of als losse geojsons
    kaartlagen = { "pakketpunten": gdf_pakketpunten,
                  "buffer_300m": gdf_bufferunion300,
                  "buffer_400m": gdf_bufferunion400,
                  "dekkingsgraad_300m" : gdf_buffers300,
                  "dekkingsgraad_400m" : gdf_buffers400,
    }

    if gdf_boundary is not None:
        kaartlagen["boundary"] = gdf_boundary 

    # output opslaan als GeoPackage of meerdere losse geojsons
    save_output(kaartlagen, filename, format)

    # output opslaan als kaart visualisatie (kaartlagen, filename, format)
    m = create_map(filename,
    gdf_points=gdf_pakketpunten,          # punten-GDF
    buffer_union300=gdf_bufferunion300,      # optioneel
    buffer_union400=gdf_bufferunion400,      # optioneel
    buffers_crs_hint=28992,               # buffers komen uit RD (EPSG:28992)
    zoom_start=12,
    tiles="CartoDB positron",             # smaakje
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Haal pakketpunten dataset op voor gegeven gemeente."
    )
    parser.add_argument("--gemeente", "-g", help="Naam van de gemeente (bijv. 'Amsterdam').")
    parser.add_argument("--filename", "-f", help="Naam van het uitvoerbestand.", default="output")
    parser.add_argument("--format", choices=["gpkg", "geojson"], default="geojson")

    # Als je in VS Code runt (zonder arguments) → gebruik defaults
    if len(sys.argv) == 1:
        gemeente = "Amsterdam"
        filename = "test"
        format = "geojson"
        print("🟢 Script gestart vanuit VS Code zonder parameters, pas handmatig inputwaardes aan.")
        main(gemeente, filename, format)
    else:
        args = parser.parse_args()
        main(args.gemeente, args.filename, args.format)



