import uuid
from datetime import UTC, datetime

from sqlalchemy.dialects import postgresql

from app.matching import match_artist_shows, servable_event
from app.models import City
from tests.helpers import make_session, result_with_rows

MONTREAL = City(
    geonameid=6077243,
    name="Montréal",
    ascii_name="Montreal",
    admin1="Quebec",
    country_code="CA",
    latitude=45.50884,
    longitude=-73.58781,
    population=1600000,
)


def test_servable_event_requires_upcoming_nearby_and_not_ignored() -> None:
    sql = str(servable_event(uuid.uuid7(), [MONTREAL]).compile(dialect=postgresql.dialect()))

    assert "events.starts_at > now()" in sql
    assert "NOT (EXISTS" in sql
    assert "user_event_exclusions" in sql


async def test_match_join_keeps_the_soonest_servable_show_per_artist() -> None:
    touring, local = uuid.uuid7(), uuid.uuid7()
    soon, later = uuid.uuid7(), uuid.uuid7()
    session = make_session()
    session.execute.return_value = result_with_rows(
        [
            (touring, soon, datetime(2026, 8, 1, 20, 0, tzinfo=UTC)),
            (touring, later, datetime(2026, 8, 5, 20, 0, tzinfo=UTC)),
            (local, later, datetime(2026, 8, 5, 20, 0, tzinfo=UTC)),
        ]
    )

    matches = await match_artist_shows(session, uuid.uuid7(), MONTREAL, include_known_artists=False)

    assert [(m.artist_id, m.event_id) for m in matches] == [(touring, soon), (local, later)]
    query = session.execute.await_args.args[0]
    sql = str(query.compile(dialect=postgresql.dialect()))
    assert "user_artist_exclusions" in sql
    assert "user_event_exclusions" in sql
