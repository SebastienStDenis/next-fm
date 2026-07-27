import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy.dialects import postgresql

from app.core.models import City, EventArtist
from app.sync.artist_sync import LOVED_TRACKS_KIND, TOP_ARTIST_KIND
from app.sync.matching import (
    SIMILAR_ARTIST_KIND,
    act_representatives,
    artist_qualifies,
    match_artist_concerts,
)
from tests.helpers import make_session, result_with_rows

USER_ID = uuid.uuid7()
NOW = datetime.now(UTC)


def identity_row(
    external_id: str, artist_id: uuid.UUID, name: str, kind: str, weight: float | None
) -> tuple:
    return (external_id, artist_id, name, kind, weight)


async def test_act_representatives_prefers_the_known_alias() -> None:
    known_id, suggested_id = uuid.uuid7(), uuid.uuid7()
    session = make_session()
    session.execute.return_value = result_with_rows(
        [
            identity_row("7928", known_id, "Robyn", LOVED_TRACKS_KIND, 6.0),
            identity_row(
                "7928", suggested_id, "Robyn & La Bagatelle Magique", SIMILAR_ARTIST_KIND, 0.9
            ),
        ]
    )

    representatives = await act_representatives(session, USER_ID, {known_id, suggested_id})

    assert representatives == {known_id: known_id, suggested_id: known_id}


async def test_act_representatives_breaks_known_ties_by_weight() -> None:
    heavy_id, light_id = uuid.uuid7(), uuid.uuid7()
    session = make_session()
    session.execute.return_value = result_with_rows(
        [
            identity_row("46239", light_id, "Kenny G.", LOVED_TRACKS_KIND, 1.0),
            identity_row("46239", heavy_id, "Kenny G", LOVED_TRACKS_KIND, 2.0),
        ]
    )

    representatives = await act_representatives(session, USER_ID, {heavy_id, light_id})

    assert representatives == {heavy_id: heavy_id, light_id: heavy_id}


async def test_act_representatives_takes_an_artists_strongest_interest() -> None:
    dual_id, alias_id = uuid.uuid7(), uuid.uuid7()
    session = make_session()
    session.execute.return_value = result_with_rows(
        [
            identity_row("118", dual_id, "Rise Against", SIMILAR_ARTIST_KIND, 0.87),
            identity_row("118", dual_id, "Rise Against", TOP_ARTIST_KIND, 6.0),
            identity_row("118", alias_id, "Rise Against Tribute", SIMILAR_ARTIST_KIND, 0.99),
        ]
    )

    representatives = await act_representatives(session, USER_ID, {dual_id, alias_id})

    assert representatives == {dual_id: dual_id, alias_id: dual_id}


async def test_act_representatives_leaves_lone_identities_implicit() -> None:
    lone_id = uuid.uuid7()
    session = make_session()
    session.execute.return_value = result_with_rows(
        [identity_row("436", lone_id, "Ben Harper", LOVED_TRACKS_KIND, 6.0)]
    )

    representatives = await act_representatives(session, USER_ID, {lone_id, uuid.uuid7()})

    assert representatives == {}


async def test_act_representatives_skips_the_query_without_artists() -> None:
    session = make_session()

    representatives = await act_representatives(session, USER_ID, set())

    assert representatives == {}
    session.execute.assert_not_awaited()


async def test_match_collapses_an_act_to_its_representative() -> None:
    known_id, alias_id, other_id = uuid.uuid7(), uuid.uuid7(), uuid.uuid7()
    soon_id, later_id = uuid.uuid7(), uuid.uuid7()
    soon, later = NOW + timedelta(days=1), NOW + timedelta(days=2)
    session = make_session()
    session.execute.side_effect = [
        result_with_rows(
            [
                (alias_id, soon_id, soon),
                (known_id, soon_id, soon),
                (other_id, later_id, later),
                (known_id, later_id, later),
            ]
        ),
        result_with_rows(
            [
                identity_row("7928", known_id, "Robyn", LOVED_TRACKS_KIND, 6.0),
                identity_row(
                    "7928", alias_id, "Robyn & La Bagatelle Magique", SIMILAR_ARTIST_KIND, 0.9
                ),
            ]
        ),
    ]
    city = City(geonameid=6077243, name="Montréal", latitude=45.5, longitude=-73.6)

    matches = await match_artist_concerts(session, USER_ID, city, include_known_artists=True)

    assert [(m.artist_id, m.event_id) for m in matches] == [
        (known_id, soon_id),
        (other_id, later_id),
    ]


def test_qualifying_guards_known_act_aliases_only_without_known_artists() -> None:
    def compiled(include_known_artists: bool) -> str:
        clause = artist_qualifies(USER_ID, EventArtist.artist_id, include_known_artists)
        return str(clause.compile(dialect=postgresql.dialect()))

    assert "bandsintown_artists" in compiled(include_known_artists=False)
    assert "bandsintown_artists" not in compiled(include_known_artists=True)
