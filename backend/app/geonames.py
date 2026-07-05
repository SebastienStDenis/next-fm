"""Parse the vendored GeoNames dumps in ``data/`` (https://download.geonames.org)."""

import io
import zipfile
from pathlib import Path
from typing import TypedDict

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
CITIES_ZIP = DATA_DIR / "cities15000.zip"
CITIES_FILENAME = "cities15000.txt"
ADMIN1_FILE = DATA_DIR / "admin1CodesASCII.txt"


class CityRecord(TypedDict):
    geonameid: int
    name: str
    ascii_name: str
    admin1: str | None
    country_code: str
    latitude: float
    longitude: float
    population: int


def load_admin1_names() -> dict[str, str]:
    """Map admin1 codes ("CA.10") to region names ("Quebec")."""
    names: dict[str, str] = {}
    for line in ADMIN1_FILE.read_text(encoding="utf-8").splitlines():
        code, name, _ascii_name, _geonameid = line.split("\t")
        names[code] = name
    return names


def load_cities() -> list[CityRecord]:
    """Load all cities (population >= 15k) from the vendored dump."""
    admin1_names = load_admin1_names()
    cities: list[CityRecord] = []
    with zipfile.ZipFile(CITIES_ZIP) as archive, archive.open(CITIES_FILENAME) as file:
        for line in io.TextIOWrapper(file, encoding="utf-8"):
            fields = line.rstrip("\n").split("\t")
            country_code = fields[8]
            cities.append(
                CityRecord(
                    geonameid=int(fields[0]),
                    name=fields[1],
                    ascii_name=fields[2],
                    admin1=admin1_names.get(f"{country_code}.{fields[10]}"),
                    country_code=country_code,
                    latitude=float(fields[4]),
                    longitude=float(fields[5]),
                    population=int(fields[14]),
                )
            )
    return cities
