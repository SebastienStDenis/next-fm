"""add spotify playlist tombstones

Revision ID: 0762875a2f29
Revises: 01343f3d13b3
Create Date: 2026-07-10 17:48:37.522758

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0762875a2f29"
down_revision: str | Sequence[str] | None = "01343f3d13b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "spotify_playlist_tombstones",
        sa.Column("id", sa.Uuid(), server_default=sa.text("uuidv7()"), nullable=False),
        sa.Column("spotify_playlist_id", sa.String(), nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("spotify_playlist_id"),
    )
    # A trigger, not app code: user deletion removes playlists via the FK
    # cascade, which the ORM never sees, and future deletion paths must not be
    # able to forget the remote cleanup. Autogenerate does not manage triggers;
    # this migration owns them (docs/design/2026-07-10-playlist-deletion-plan.md).
    op.execute(
        """
        CREATE FUNCTION tombstone_spotify_playlist() RETURNS trigger AS $$
        BEGIN
            IF OLD.spotify_playlist_id IS NOT NULL THEN
                INSERT INTO spotify_playlist_tombstones (spotify_playlist_id, source)
                VALUES (OLD.spotify_playlist_id, 'delete')
                ON CONFLICT (spotify_playlist_id) DO NOTHING;
            END IF;
            RETURN OLD;
        END
        $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        """
        CREATE TRIGGER playlists_tombstone BEFORE DELETE ON playlists
        FOR EACH ROW EXECUTE FUNCTION tombstone_spotify_playlist()
        """
    )
    # A pin whose city vanished is meaningless: delete it (the trigger above
    # tombstones its remote id) instead of SET NULL, which would collide with
    # the default playlist on the nulls-not-distinct unique constraint.
    op.drop_constraint("playlists_city_id_fkey", "playlists", type_="foreignkey")
    op.create_foreign_key(
        "playlists_city_id_fkey",
        "playlists",
        "cities",
        ["city_id"],
        ["geonameid"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint("playlists_city_id_fkey", "playlists", type_="foreignkey")
    op.create_foreign_key(
        "playlists_city_id_fkey",
        "playlists",
        "cities",
        ["city_id"],
        ["geonameid"],
        ondelete="SET NULL",
    )
    op.execute("DROP TRIGGER playlists_tombstone ON playlists")
    op.execute("DROP FUNCTION tombstone_spotify_playlist()")
    op.drop_table("spotify_playlist_tombstones")
