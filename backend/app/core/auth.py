import uuid
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.db import get_session
from app.core.models import User

ALLOWED_ALGORITHMS = ("HS256", "ES256", "RS256")

# last_seen_at records general user activity; hourly precision is plenty, and
# the throttle keeps it to at most one extra UPDATE per user per hour.
LAST_SEEN_REFRESH = timedelta(hours=1)


class Claims(BaseModel):
    sub: uuid.UUID
    email: str | None = None
    display_name: str | None = None


@lru_cache
def _jwks_client(jwks_url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(jwks_url)


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(status_code=401, detail=detail, headers={"WWW-Authenticate": "Bearer"})


def verify_token(token: str, settings: Settings) -> Claims:
    """Verify a Supabase-issued JWT and distill the claims the app uses.

    Dispatches on the token's declared algorithm: HS256 verifies against the
    shared JWT secret (rejected when none is configured), asymmetric
    algorithms verify against the project's published JWKS.
    """
    issuer = settings.supabase_issuer or f"{settings.supabase_url}/auth/v1"
    try:
        alg = jwt.get_unverified_header(token).get("alg")
        if alg not in ALLOWED_ALGORITHMS:
            raise _unauthorized("Unsupported token algorithm")
        if alg == "HS256":
            if not settings.supabase_jwt_secret:
                raise _unauthorized("Unsupported token algorithm")
            key = settings.supabase_jwt_secret
        else:
            jwks_url = f"{settings.supabase_url}/auth/v1/.well-known/jwks.json"
            key = _jwks_client(jwks_url).get_signing_key_from_jwt(token).key
        payload = jwt.decode(token, key, algorithms=[alg], audience="authenticated", issuer=issuer)
    except jwt.PyJWTError:
        raise _unauthorized("Invalid or expired token") from None
    sub = payload.get("sub")
    if sub is None:
        raise _unauthorized("Invalid or expired token")
    metadata = payload.get("user_metadata") or {}
    return Claims(sub=sub, email=payload.get("email"), display_name=metadata.get("display_name"))


_bearer = HTTPBearer(auto_error=False)


def get_claims(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> Claims:
    # Sync on purpose: FastAPI runs it in the threadpool, so the blocking
    # JWKS fetch inside PyJWKClient never stalls the event loop.
    if credentials is None:
        raise _unauthorized("Not authenticated")
    return verify_token(credentials.credentials, get_settings())


async def get_current_user(
    claims: Annotated[Claims, Depends(get_claims)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> User:
    """Resolve the token to our User row, creating it on first login."""
    now = datetime.now(UTC)
    result = await session.execute(select(User).where(User.supabase_user_id == claims.sub))
    user = result.scalar_one_or_none()
    if user is None:
        name = claims.display_name or (claims.email or "").split("@")[0] or "Audiophil"
        user = User(supabase_user_id=claims.sub, name=name, last_seen_at=now)
        session.add(user)
        try:
            await session.commit()
        except IntegrityError:
            # A concurrent first request provisioned the same user; adopt it.
            await session.rollback()
            result = await session.execute(select(User).where(User.supabase_user_id == claims.sub))
            user = result.scalar_one()
    if user.last_seen_at is None or now - user.last_seen_at >= LAST_SEEN_REFRESH:
        user.last_seen_at = now
        await session.commit()
    return user


CurrentUserDep = Annotated[User, Depends(get_current_user)]
