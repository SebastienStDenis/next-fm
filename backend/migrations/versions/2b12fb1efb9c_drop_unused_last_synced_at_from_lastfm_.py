"""drop unused last_synced_at from lastfm_artists

Revision ID: 2b12fb1efb9c
Revises: d5b929ae1174
Create Date: 2026-07-14 08:14:28.417881

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "2b12fb1efb9c"
down_revision: str | Sequence[str] | None = "d5b929ae1174"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_column("lastfm_artists", "last_synced_at")


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column(
        "lastfm_artists", sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True)
    )
