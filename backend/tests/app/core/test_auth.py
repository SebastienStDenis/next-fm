import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from fastapi import HTTPException

from app.core.auth import verify_token
from app.core.config import Settings

SECRET = "test-secret-test-secret-test-secret!"
ISSUER = "http://127.0.0.1:54321/auth/v1"


def make_settings(**overrides: object) -> Settings:
    defaults: dict = {
        "_env_file": None,
        "supabase_url": "http://127.0.0.1:54321",
        "supabase_jwt_secret": SECRET,
    }
    defaults.update(overrides)
    return Settings(**defaults)


def make_token(secret: str = SECRET, algorithm: str = "HS256", **overrides: object) -> str:
    now = datetime.now(UTC)
    payload: dict = {
        "sub": str(uuid.uuid4()),
        "aud": "authenticated",
        "iss": ISSUER,
        "exp": now + timedelta(seconds=60),
        "email": "ada@example.com",
        "user_metadata": {"display_name": "Ada"},
    }
    payload.update(overrides)
    return jwt.encode(payload, secret, algorithm=algorithm)


def test_valid_token_round_trips_claims() -> None:
    sub = uuid.uuid4()
    token = make_token(sub=str(sub))

    claims = verify_token(token, make_settings())

    assert claims.sub == sub
    assert claims.email == "ada@example.com"
    assert claims.display_name == "Ada"


def test_expired_token_is_rejected() -> None:
    token = make_token(exp=datetime.now(UTC) - timedelta(seconds=1))

    with pytest.raises(HTTPException) as exc:
        verify_token(token, make_settings())
    assert exc.value.status_code == 401


def test_wrong_audience_is_rejected() -> None:
    token = make_token(aud="anon")

    with pytest.raises(HTTPException) as exc:
        verify_token(token, make_settings())
    assert exc.value.status_code == 401


def test_wrong_issuer_is_rejected() -> None:
    token = make_token(iss="https://evil.example/auth/v1")

    with pytest.raises(HTTPException) as exc:
        verify_token(token, make_settings())
    assert exc.value.status_code == 401


def test_tampered_signature_is_rejected() -> None:
    token = make_token(secret="a-different-secret-a-different-secret!")

    with pytest.raises(HTTPException) as exc:
        verify_token(token, make_settings())
    assert exc.value.status_code == 401


def test_hs256_rejected_when_no_secret_configured() -> None:
    token = make_token()

    with pytest.raises(HTTPException) as exc:
        verify_token(token, make_settings(supabase_jwt_secret=""))
    assert exc.value.status_code == 401


def test_algorithm_outside_allowlist_is_rejected() -> None:
    token = jwt.encode(
        {
            "sub": str(uuid.uuid4()),
            "aud": "authenticated",
            "iss": ISSUER,
            "exp": datetime.now(UTC) + timedelta(seconds=60),
        },
        SECRET,
        algorithm="HS384",
    )

    with pytest.raises(HTTPException) as exc:
        verify_token(token, make_settings())
    assert exc.value.status_code == 401
