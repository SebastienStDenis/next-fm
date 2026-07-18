"""add event street_address

Revision ID: 80c631b00f68
Revises: 2b12fb1efb9c
Create Date: 2026-07-17 23:15:21.630047

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "80c631b00f68"
down_revision: str | Sequence[str] | None = "2b12fb1efb9c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("events", sa.Column("street_address", sa.String(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("events", "street_address")
