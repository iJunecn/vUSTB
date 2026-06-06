"""Migration: Fix players.skin_texture_id and players.cape_texture_id FK constraints.

For existing databases, the foreign keys on players.skin_texture_id and
players.cape_texture_id were created WITHOUT ondelete="SET NULL", which
causes ForeignKeyViolationError when deleting a user whose textures are
referenced by players.

Run this once against the production database to alter the constraints.

Usage:
    docker compose exec postgres psql -U vustb -d vustb -f /path/fix_player_texture_fkey.sql

Or directly:
    psql -U vustb -d vustb < fix_player_texture_fkey.sql
"""

-- Fix skin_texture_id FK: change from RESTRICT (default) to SET NULL
ALTER TABLE players
    DROP CONSTRAINT IF EXISTS players_skin_texture_id_fkey,
    ADD CONSTRAINT players_skin_texture_id_fkey
        FOREIGN KEY (skin_texture_id) REFERENCES textures(id)
        ON DELETE SET NULL;

-- Fix cape_texture_id FK: change from RESTRICT (default) to SET NULL
ALTER TABLE players
    DROP CONSTRAINT IF EXISTS players_cape_texture_id_fkey,
    ADD CONSTRAINT players_cape_texture_id_fkey
        FOREIGN KEY (cape_texture_id) REFERENCES textures(id)
        ON DELETE SET NULL;
