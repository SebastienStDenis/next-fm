"""rename city_shows playlist kind to city_concerts

Revision ID: e6c3fa284531
Revises: 5e37d0040133
Create Date: 2026-07-09 08:12:25.214708

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e6c3fa284531"
down_revision: str | Sequence[str] | None = "5e37d0040133"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("UPDATE playlists SET kind = 'city_concerts' WHERE kind = 'city_shows'")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("UPDATE playlists SET kind = 'city_shows' WHERE kind = 'city_concerts'")
