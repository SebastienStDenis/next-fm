"""Fetch and parse the GeoNames dumps (https://download.geonames.org)."""

import io
import zipfile
from typing import TypedDict

import httpx

DUMP_BASE_URL = "https://download.geonames.org/export/dump"
CITIES_ZIP = "cities15000.zip"
CITIES_FILENAME = "cities15000.txt"
ADMIN1_FILE = "admin1CodesASCII.txt"


class CityRecord(TypedDict):
    geonameid: int
    name: str
    ascii_name: str
    admin1: str | None
    country_code: str
    latitude: float
    longitude: float
    population: int


def parse_admin1_names(text: str) -> dict[str, str]:
    """Map admin1 codes ("CA.10") to region names ("Quebec")."""
    names: dict[str, str] = {}
    for line in text.splitlines():
        code, name, _ascii_name, _geonameid = line.split("\t")
        names[code] = name
    return names


def parse_cities(zip_bytes: bytes, admin1_names: dict[str, str]) -> list[CityRecord]:
    """Parse all cities (population >= 15k) from the zipped dump."""
    cities: list[CityRecord] = []
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive, archive.open(CITIES_FILENAME) as file:
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


async def fetch_cities() -> list[CityRecord]:
    """Download the current dumps from GeoNames and parse them."""
    async with httpx.AsyncClient(base_url=DUMP_BASE_URL, timeout=60) as client:
        admin1_response = await client.get(f"/{ADMIN1_FILE}")
        admin1_response.raise_for_status()
        cities_response = await client.get(f"/{CITIES_ZIP}")
        cities_response.raise_for_status()
    admin1_names = parse_admin1_names(admin1_response.text)
    return parse_cities(cities_response.content, admin1_names)
