import uuid
from unittest.mock import MagicMock

from app.geonames import load_cities
from app.models import City, User
from tests.helpers import make_session, request

USER_ID = uuid.uuid7()

MONTREAL = City(
    geonameid=6077243,
    name="Montréal",
    ascii_name="Montreal",
    admin1="Quebec",
    country_code="CA",
    latitude=45.50884,
    longitude=-73.58781,
    population=1762949,
)


def result_returning_all(values: list[object]) -> MagicMock:
    result = MagicMock()
    result.scalars.return_value = values
    return result


async def test_search_cities() -> None:
    session = make_session()
    session.execute.return_value = result_returning_all([MONTREAL])

    response = await request("GET", "/cities?q=montr", session)

    assert response.status_code == 200
    body = response.json()
    assert body == [
        {
            "geonameid": 6077243,
            "name": "Montréal",
            "admin1": "Quebec",
            "country_code": "CA",
            "latitude": 45.50884,
            "longitude": -73.58781,
        }
    ]


async def test_search_cities_requires_query() -> None:
    session = make_session()

    response = await request("GET", "/cities", session)

    assert response.status_code == 422
    session.execute.assert_not_awaited()


async def test_search_cities_rejects_short_query() -> None:
    session = make_session()

    response = await request("GET", "/cities?q=m", session)

    assert response.status_code == 422
    session.execute.assert_not_awaited()


async def test_search_cities_rejects_whitespace_query() -> None:
    session = make_session()

    response = await request("GET", "/cities?q=%20%20%20", session)

    assert response.status_code == 422
    session.execute.assert_not_awaited()


async def test_get_user_city() -> None:
    session = make_session()
    session.get.side_effect = [User(id=USER_ID, name="Alice", city_id=6077243), MONTREAL]

    response = await request("GET", f"/users/{USER_ID}/city", session)

    assert response.status_code == 200
    assert response.json()["name"] == "Montréal"


async def test_get_user_city_when_none_set() -> None:
    session = make_session()
    session.get.return_value = User(id=USER_ID, name="Alice", city_id=None)

    response = await request("GET", f"/users/{USER_ID}/city", session)

    assert response.status_code == 404
    assert response.json()["detail"] == "No city set"


async def test_get_user_city_unknown_user() -> None:
    session = make_session()
    session.get.return_value = None

    response = await request("GET", f"/users/{USER_ID}/city", session)

    assert response.status_code == 404
    assert response.json()["detail"] == "User not found"


async def test_set_user_city() -> None:
    user = User(id=USER_ID, name="Alice", city_id=None)
    session = make_session()
    session.get.side_effect = [user, MONTREAL]

    response = await request("PUT", f"/users/{USER_ID}/city", session, json={"geonameid": 6077243})

    assert response.status_code == 200
    assert response.json()["geonameid"] == 6077243
    assert user.city_id == 6077243
    session.commit.assert_awaited_once()


async def test_set_user_city_unknown_city() -> None:
    session = make_session()
    session.get.side_effect = [User(id=USER_ID, name="Alice", city_id=None), None]

    response = await request("PUT", f"/users/{USER_ID}/city", session, json={"geonameid": 1})

    assert response.status_code == 404
    assert response.json()["detail"] == "City not found"
    session.commit.assert_not_awaited()


async def test_clear_user_city() -> None:
    user = User(id=USER_ID, name="Alice", city_id=6077243)
    session = make_session()
    session.get.return_value = user

    response = await request("DELETE", f"/users/{USER_ID}/city", session)

    assert response.status_code == 204
    assert user.city_id is None
    session.commit.assert_awaited_once()


async def test_clear_user_city_when_none_set() -> None:
    session = make_session()
    session.get.return_value = User(id=USER_ID, name="Alice", city_id=None)

    response = await request("DELETE", f"/users/{USER_ID}/city", session)

    assert response.status_code == 404
    assert response.json()["detail"] == "No city set"
    session.commit.assert_not_awaited()


def test_load_cities_parses_vendored_dump() -> None:
    cities = load_cities()

    assert len(cities) > 30_000
    montreal = next(city for city in cities if city["geonameid"] == 6077243)
    assert montreal["name"] == "Montréal"
    assert montreal["ascii_name"] == "Montreal"
    assert montreal["admin1"] == "Quebec"
    assert montreal["country_code"] == "CA"
    assert montreal["latitude"] == 45.50884
    assert montreal["longitude"] == -73.58781
    assert montreal["population"] > 1_000_000
