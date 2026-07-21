import io
import zipfile

from cli.geonames import CITIES_FILENAME, parse_admin1_names, parse_cities

ADMIN1_TEXT = "CA.10\tQuebec\tQuebec\t6115047\nUS.CA\tCalifornia\tCalifornia\t5332921"


def dump_row(
    geonameid: str,
    name: str,
    ascii_name: str,
    latitude: str,
    longitude: str,
    country_code: str,
    admin1_code: str,
    population: str,
) -> str:
    fields = [""] * 19
    fields[0] = geonameid
    fields[1] = name
    fields[2] = ascii_name
    fields[4] = latitude
    fields[5] = longitude
    fields[8] = country_code
    fields[10] = admin1_code
    fields[14] = population
    return "\t".join(fields) + "\n"


def cities_zip(rows: list[str]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(CITIES_FILENAME, "".join(rows))
    return buffer.getvalue()


def test_parse_admin1_names():
    assert parse_admin1_names(ADMIN1_TEXT) == {"CA.10": "Quebec", "US.CA": "California"}


def test_parse_cities_maps_fields_and_joins_admin1():
    row = dump_row(
        "6077243", "Montréal", "Montreal", "45.50884", "-73.58781", "CA", "10", "1780000"
    )
    zip_bytes = cities_zip([row])

    cities = parse_cities(zip_bytes, parse_admin1_names(ADMIN1_TEXT))

    assert cities == [
        {
            "geonameid": 6077243,
            "name": "Montréal",
            "ascii_name": "Montreal",
            "admin1": "Quebec",
            "country_code": "CA",
            "latitude": 45.50884,
            "longitude": -73.58781,
            "population": 1780000,
        }
    ]


def test_parse_cities_unknown_admin1_is_none():
    zip_bytes = cities_zip(
        [dump_row("2988507", "Paris", "Paris", "48.85341", "2.3488", "FR", "11", "2138551")]
    )

    cities = parse_cities(zip_bytes, parse_admin1_names(ADMIN1_TEXT))

    assert cities[0]["admin1"] is None
    assert cities[0]["country_code"] == "FR"
