"""switch users id to uuidv7

Revision ID: e62586de0c47
Revises: 5081518b5f4f
Create Date: 2026-07-04 14:26:14.612317

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e62586de0c47"
down_revision: str | Sequence[str] | None = "5081518b5f4f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_column("users", "id")
    op.add_column(
        "users",
        sa.Column("id", sa.Uuid(), server_default=sa.text("uuidv7()"), nullable=False),
    )
    op.create_primary_key("users_pkey", "users", ["id"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("users", "id")
    op.add_column("users", sa.Column("id", sa.Integer(), sa.Identity(), nullable=False))
    op.create_primary_key("users_pkey", "users", ["id"])
