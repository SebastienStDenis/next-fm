import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

from app.artist_sync import loved_track_signals, top_artist_signals
from app.lastfm import (
    LastfmApiError,
    LastfmClient,
    LastfmLovedTrack,
    LastfmLovedTracksPage,
    LastfmPrivateDataError,
    LastfmTopArtist,
    LastfmUserNotFoundError,
)
from app.models import Artist, LastfmAccount, LastfmArtist, UserArtistInterest
from tests.helpers import make_session, request, result_returning

USER_ID = uuid.uuid7()
SYNC_URL = f"/users/{USER_ID}/lastfm/artists/sync"


def top_artist(name: str, rank: int | None = None, playcount: int | None = None) -> LastfmTopArtist:
    return LastfmTopArtist(
        name=name,
        url=f"https://www.last.fm/music/{name.replace(' ', '+')}",
        mbid=None,
        playcount=playcount,
        rank=rank,
    )


def loved_track(title: str, artist_name: str) -> LastfmLovedTrack:
    return LastfmLovedTrack(title=title, artist_name=artist_name, artist_url=None, artist_mbid=None)


def make_account() -> LastfmAccount:
    return LastfmAccount(id=uuid.uuid7(), username="rj")


def result_with_scalars(rows: list) -> MagicMock:
    result = MagicMock()
    result.scalars.return_value = rows
    return result


def result_with_rows(rows: list) -> MagicMock:
    result = MagicMock()
    result.all.return_value = rows
    return result


def added_objects(session: AsyncMock, kind: type) -> list:
    return [call.args[0] for call in session.add.call_args_list if isinstance(call.args[0], kind)]


def test_top_artist_signals_builds_rank_evidence() -> None:
    signals = top_artist_signals([top_artist("Autechre", rank=1, playcount=321)])

    assert len(signals) == 1
    assert signals[0].name == "Autechre"
    assert signals[0].url == "https://www.last.fm/music/Autechre"
    assert signals[0].evidence == {"rank": 1, "playcount": 321, "period": "12month"}


def test_top_artist_signals_keeps_missing_fields_as_none() -> None:
    signals = top_artist_signals(
        [LastfmTopArtist(name="X", url=None, mbid=None, playcount=None, rank=None)]
    )

    assert signals[0].evidence == {"rank": None, "playcount": None, "period": "12month"}


def test_top_artist_signals_dedupes_case_insensitively() -> None:
    signals = top_artist_signals(
        [top_artist("MUSE", rank=1, playcount=100), top_artist("muse", rank=2, playcount=50)]
    )

    assert len(signals) == 1
    assert signals[0].name == "MUSE"
    assert signals[0].evidence["rank"] == 1


def test_loved_track_signals_counts_tracks_per_artist() -> None:
    signals = loved_track_signals(
        [
            loved_track("Windowlicker", "Aphex Twin"),
            loved_track("Avril 14th", "aphex twin"),
            loved_track("Roygbiv", "Boards of Canada"),
        ]
    )

    by_name = {signal.name: signal for signal in signals}
    assert set(by_name) == {"Aphex Twin", "Boards of Canada"}
    assert by_name["Aphex Twin"].evidence == {"track_count": 2}
    assert by_name["Boards of Canada"].evidence == {"track_count": 1}


def test_signal_builders_handle_empty_input() -> None:
    assert top_artist_signals([]) == []
    assert loved_track_signals([]) == []


async def test_sync_creates_artists_and_interests() -> None:
    session = make_session()
    session.execute.side_effect = [
        result_returning(make_account()),
        result_with_scalars([]),
        result_with_rows([]),
        result_with_scalars([]),
        result_with_scalars([]),
        result_with_rows([]),
        result_with_scalars([]),
    ]
    lastfm = AsyncMock(spec=LastfmClient)
    lastfm.get_top_artists.return_value = [
        top_artist("Autechre", rank=1, playcount=321),
        top_artist("Boards of Canada", rank=2, playcount=210),
    ]
    lastfm.get_loved_tracks.return_value = LastfmLovedTracksPage(
        tracks=[loved_track("Windowlicker", "Aphex Twin")], total_pages=1
    )

    response = await request("POST", SYNC_URL, session, lastfm)

    assert response.status_code == 200
    body = response.json()
    assert body["results"] == [
        {
            "kind": "lastfm_top_artist",
            "artists": 2,
            "interests_created": 2,
            "interests_updated": 0,
            "interests_removed": 0,
        },
        {
            "kind": "lastfm_loved_tracks",
            "artists": 1,
            "interests_created": 1,
            "interests_updated": 0,
            "interests_removed": 0,
        },
    ]
    lastfm.get_top_artists.assert_awaited_once_with("rj", period="12month", limit=200)
    assert len(added_objects(session, Artist)) == 3
    interests = added_objects(session, UserArtistInterest)
    assert [interest.evidence for interest in interests] == [
        {"rank": 1, "playcount": 321, "period": "12month"},
        {"rank": 2, "playcount": 210, "period": "12month"},
        {"track_count": 1},
    ]
    assert all(interest.user_id == USER_ID for interest in interests)
    assert all(interest.source == "lastfm" for interest in interests)
    session.commit.assert_awaited_once()


async def test_resync_updates_and_prunes_interests() -> None:
    autechre_id = uuid.uuid7()
    existing_row = LastfmArtist(
        id=uuid.uuid7(), artist_id=autechre_id, name="autechre", name_key="autechre"
    )
    kept = UserArtistInterest(
        user_id=USER_ID,
        artist_id=autechre_id,
        kind="lastfm_top_artist",
        source="lastfm",
        evidence={"rank": 5, "playcount": 100, "period": "12month"},
    )
    gone = UserArtistInterest(
        user_id=USER_ID,
        artist_id=uuid.uuid7(),
        kind="lastfm_top_artist",
        source="lastfm",
        evidence={"rank": 1, "playcount": 999, "period": "12month"},
    )
    session = make_session()
    session.execute.side_effect = [
        result_returning(make_account()),
        result_with_scalars([existing_row]),
        result_with_scalars([kept, gone]),
        result_with_scalars([]),
        result_with_scalars([]),
    ]
    lastfm = AsyncMock(spec=LastfmClient)
    lastfm.get_top_artists.return_value = [top_artist("Autechre", rank=1, playcount=321)]
    lastfm.get_loved_tracks.return_value = LastfmLovedTracksPage(tracks=[], total_pages=1)

    response = await request("POST", SYNC_URL, session, lastfm)

    assert response.status_code == 200
    assert response.json()["results"][0] == {
        "kind": "lastfm_top_artist",
        "artists": 1,
        "interests_created": 0,
        "interests_updated": 1,
        "interests_removed": 1,
    }
    assert kept.evidence == {"rank": 1, "playcount": 321, "period": "12month"}
    session.delete.assert_awaited_once_with(gone)
    session.add.assert_not_called()
    session.commit.assert_awaited_once()


async def test_sync_fetches_all_loved_track_pages() -> None:
    session = make_session()
    session.execute.side_effect = [
        result_returning(make_account()),
        result_with_scalars([]),
        result_with_scalars([]),
        result_with_scalars([]),
        result_with_rows([]),
        result_with_scalars([]),
    ]
    lastfm = AsyncMock(spec=LastfmClient)
    lastfm.get_top_artists.return_value = []
    lastfm.get_loved_tracks.side_effect = [
        LastfmLovedTracksPage(tracks=[loved_track("Windowlicker", "Aphex Twin")], total_pages=2),
        LastfmLovedTracksPage(
            tracks=[
                loved_track("Avril 14th", "Aphex Twin"),
                loved_track("Roygbiv", "Boards of Canada"),
            ],
            total_pages=2,
        ),
    ]

    response = await request("POST", SYNC_URL, session, lastfm)

    assert response.status_code == 200
    assert response.json()["results"][1] == {
        "kind": "lastfm_loved_tracks",
        "artists": 2,
        "interests_created": 2,
        "interests_updated": 0,
        "interests_removed": 0,
    }
    assert [call.kwargs["page"] for call in lastfm.get_loved_tracks.await_args_list] == [1, 2]
    interests = added_objects(session, UserArtistInterest)
    assert [interest.evidence for interest in interests] == [{"track_count": 2}, {"track_count": 1}]


async def test_sync_unknown_user() -> None:
    session = make_session()
    session.get.return_value = None

    response = await request("POST", SYNC_URL, session, AsyncMock(spec=LastfmClient))

    assert response.status_code == 404
    assert response.json()["detail"] == "User not found"


async def test_sync_when_not_linked() -> None:
    session = make_session()
    session.execute.return_value = result_returning(None)

    response = await request("POST", SYNC_URL, session, AsyncMock(spec=LastfmClient))

    assert response.status_code == 404
    assert response.json()["detail"] == "No Last.fm account linked"


async def test_sync_unknown_lastfm_user() -> None:
    session = make_session()
    session.execute.return_value = result_returning(make_account())
    lastfm = AsyncMock(spec=LastfmClient)
    lastfm.get_top_artists.side_effect = LastfmUserNotFoundError("rj")

    response = await request("POST", SYNC_URL, session, lastfm)

    assert response.status_code == 404
    assert response.json()["detail"] == "Last.fm user not found"
    session.commit.assert_not_awaited()


async def test_sync_skips_pruning_when_loved_tracks_are_truncated() -> None:
    old_interest = UserArtistInterest(
        user_id=USER_ID,
        artist_id=uuid.uuid7(),
        kind="lastfm_loved_tracks",
        source="lastfm",
        evidence={"track_count": 1},
    )
    session = make_session()
    session.execute.side_effect = [
        result_returning(make_account()),
        result_with_scalars([]),
        result_with_scalars([]),
        result_with_scalars([]),
        result_with_rows([]),
        result_with_scalars([old_interest]),
    ]
    lastfm = AsyncMock(spec=LastfmClient)
    lastfm.get_top_artists.return_value = []
    lastfm.get_loved_tracks.side_effect = [
        LastfmLovedTracksPage(tracks=[loved_track(f"Track {page}", "Aphex Twin")], total_pages=12)
        for page in range(1, 11)
    ]

    response = await request("POST", SYNC_URL, session, lastfm)

    assert response.status_code == 200
    assert response.json()["results"][1]["interests_removed"] == 0
    assert len(lastfm.get_loved_tracks.await_args_list) == 10
    session.delete.assert_not_awaited()


async def test_sync_maps_unknown_lastfm_error_to_502() -> None:
    session = make_session()
    session.execute.return_value = result_returning(make_account())
    lastfm = AsyncMock(spec=LastfmClient)
    lastfm.get_top_artists.side_effect = LastfmApiError(29, "Rate limit exceeded")

    response = await request("POST", SYNC_URL, session, lastfm)

    assert response.status_code == 502
    assert response.json()["detail"] == "Last.fm error 29: Rate limit exceeded"
    session.commit.assert_not_awaited()


async def test_sync_private_lastfm_data() -> None:
    session = make_session()
    session.execute.return_value = result_returning(make_account())
    lastfm = AsyncMock(spec=LastfmClient)
    lastfm.get_top_artists.side_effect = LastfmPrivateDataError("rj")

    response = await request("POST", SYNC_URL, session, lastfm)

    assert response.status_code == 403
    assert response.json()["detail"] == "This Last.fm account's listening data is private"
    session.commit.assert_not_awaited()


async def test_list_user_artists_groups_interests_by_artist() -> None:
    now = datetime(2026, 7, 1, tzinfo=UTC)

    def interest(artist: Artist, kind: str, evidence: dict) -> UserArtistInterest:
        return UserArtistInterest(
            user_id=USER_ID,
            artist_id=artist.id,
            kind=kind,
            source="lastfm",
            evidence=evidence,
            created_at=now,
            updated_at=now,
        )

    autechre = Artist(id=uuid.uuid7(), name="Autechre")
    boc = Artist(id=uuid.uuid7(), name="Boards of Canada")
    session = make_session()
    session.execute.return_value = result_with_rows(
        [
            (interest(autechre, "lastfm_loved_tracks", {"track_count": 3}), autechre),
            (
                interest(
                    autechre,
                    "lastfm_top_artist",
                    {"rank": 1, "playcount": 321, "period": "12month"},
                ),
                autechre,
            ),
            (
                interest(
                    boc, "lastfm_top_artist", {"rank": 2, "playcount": 210, "period": "12month"}
                ),
                boc,
            ),
        ]
    )

    response = await request("GET", f"/users/{USER_ID}/artists", session)

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 2
    assert body[0]["artist"] == {"id": str(autechre.id), "name": "Autechre"}
    assert [entry["kind"] for entry in body[0]["interests"]] == [
        "lastfm_loved_tracks",
        "lastfm_top_artist",
    ]
    assert body[0]["interests"][0]["evidence"] == {"track_count": 3}
    assert body[0]["interests"][0]["source"] == "lastfm"
    assert body[1]["artist"] == {"id": str(boc.id), "name": "Boards of Canada"}
    assert len(body[1]["interests"]) == 1


async def test_list_user_artists_unknown_user() -> None:
    session = make_session()
    session.get.return_value = None

    response = await request("GET", f"/users/{USER_ID}/artists", session)

    assert response.status_code == 404
    assert response.json()["detail"] == "User not found"


async def test_list_artists() -> None:
    artists = [
        Artist(id=uuid.uuid7(), name="Autechre"),
        Artist(id=uuid.uuid7(), name="Boards of Canada"),
    ]
    session = make_session()
    session.execute.return_value = result_with_scalars(artists)

    response = await request("GET", "/artists", session)

    assert response.status_code == 200
    assert response.json() == [{"id": str(artist.id), "name": artist.name} for artist in artists]
