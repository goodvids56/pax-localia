import type Database from 'better-sqlite3';

interface Migration {
  version: number;
  description: string;
  sql: string;
}

export const migrations: readonly Migration[] = [
  {
    version: 1,
    description: 'Initial snapshot-first game store and indexed projections',
    sql: `
      CREATE TABLE app_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE scenarios (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL CHECK(source IN ('bundled', 'user', 'imported')),
        version TEXT NOT NULL,
        title TEXT NOT NULL,
        json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE scenario_versions (
        scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
        version TEXT NOT NULL,
        json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (scenario_id, version)
      );

      CREATE TABLE scenario_assets (
        id TEXT PRIMARY KEY,
        scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
        media_type TEXT NOT NULL,
        checksum TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        local_name TEXT NOT NULL
      );

      CREATE TABLE games (
        id TEXT PRIMARY KEY,
        scenario_id TEXT NOT NULL REFERENCES scenarios(id),
        title TEXT NOT NULL,
        player_actor_id TEXT NOT NULL,
        active_branch_id TEXT NOT NULL,
        difficulty TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        seed INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE branches (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        parent_branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
        branch_point_turn INTEGER NOT NULL,
        label TEXT NOT NULL,
        current_turn INTEGER NOT NULL,
        current_date TEXT NOT NULL,
        world_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE turns (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        status TEXT NOT NULL,
        record_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        UNIQUE(branch_id, sequence)
      );

      CREATE TABLE snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        turn_number INTEGER NOT NULL,
        in_world_date TEXT NOT NULL,
        world_json TEXT NOT NULL,
        canonical_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(branch_id, turn_number)
      );

      CREATE TABLE actions (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        actor_id TEXT NOT NULL,
        json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE events (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        turn_number INTEGER NOT NULL,
        in_world_date TEXT NOT NULL,
        category TEXT NOT NULL,
        severity INTEGER NOT NULL,
        actor_ids TEXT NOT NULL,
        region_ids TEXT NOT NULL,
        json TEXT NOT NULL
      );

      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0,
        updated_date TEXT NOT NULL,
        json TEXT NOT NULL
      );

      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        speaker_actor_id TEXT,
        in_world_date TEXT NOT NULL,
        created_at TEXT NOT NULL,
        json TEXT NOT NULL
      );

      CREATE TABLE commitments (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        from_actor_id TEXT NOT NULL,
        json TEXT NOT NULL
      );

      CREATE TABLE actors (
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        active INTEGER NOT NULL,
        json TEXT NOT NULL,
        PRIMARY KEY (branch_id, id)
      );

      CREATE TABLE regions (
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        owner_actor_id TEXT,
        controller_actor_id TEXT,
        json TEXT NOT NULL,
        PRIMARY KEY (branch_id, id)
      );

      CREATE TABLE cities (
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        region_id TEXT NOT NULL,
        controller_actor_id TEXT,
        json TEXT NOT NULL,
        PRIMARY KEY (branch_id, id)
      );

      CREATE TABLE military_units (
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        region_id TEXT NOT NULL,
        json TEXT NOT NULL,
        PRIMARY KEY (branch_id, id)
      );

      CREATE TABLE relationships (
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        from_actor_id TEXT NOT NULL,
        to_actor_id TEXT NOT NULL,
        score INTEGER NOT NULL,
        json TEXT NOT NULL,
        PRIMARY KEY (branch_id, from_actor_id, to_actor_id)
      );

      CREATE TABLE treaties (
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        status TEXT NOT NULL,
        json TEXT NOT NULL,
        PRIMARY KEY (branch_id, id)
      );

      CREATE TABLE conflicts (
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        status TEXT NOT NULL,
        json TEXT NOT NULL,
        PRIMARY KEY (branch_id, id)
      );

      CREATE TABLE memory_summaries (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('block', 'era')),
        start_turn INTEGER NOT NULL,
        end_turn INTEGER NOT NULL,
        event_ids TEXT NOT NULL,
        facts_json TEXT NOT NULL,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE ai_requests (
        id TEXT PRIMARY KEY,
        game_id TEXT REFERENCES games(id) ON DELETE CASCADE,
        branch_id TEXT REFERENCES branches(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        purpose TEXT NOT NULL,
        prompt_hash TEXT NOT NULL,
        prompt_chars INTEGER NOT NULL,
        response_chars INTEGER,
        status TEXT NOT NULL,
        error_code TEXT,
        timing_ms INTEGER,
        created_at TEXT NOT NULL
      );

      CREATE TABLE import_history (
        id TEXT PRIMARY KEY,
        package_type TEXT NOT NULL,
        package_id TEXT NOT NULL,
        checksum TEXT NOT NULL,
        result TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX idx_games_updated ON games(updated_at DESC);
      CREATE INDEX idx_branches_game_updated ON branches(game_id, updated_at DESC);
      CREATE INDEX idx_turns_game_branch_sequence ON turns(game_id, branch_id, sequence);
      CREATE INDEX idx_snapshots_game_branch_turn ON snapshots(game_id, branch_id, turn_number);
      CREATE INDEX idx_actions_game_branch_status ON actions(game_id, branch_id, status, sort_order);
      CREATE INDEX idx_events_game_branch_date ON events(game_id, branch_id, in_world_date DESC);
      CREATE INDEX idx_events_category ON events(game_id, category, in_world_date DESC);
      CREATE INDEX idx_events_actor_ids ON events(game_id, actor_ids);
      CREATE INDEX idx_regions_actor ON regions(game_id, branch_id, controller_actor_id);
      CREATE INDEX idx_units_actor_region ON military_units(game_id, branch_id, actor_id, region_id);
      CREATE INDEX idx_conversations_game_updated ON conversations(game_id, branch_id, updated_date DESC);
      CREATE INDEX idx_messages_conversation_created ON messages(conversation_id, created_at);
      CREATE INDEX idx_memory_turns ON memory_summaries(game_id, branch_id, start_turn, end_turn);
    `,
  },
  {
    version: 2,
    description: 'Local model probe cache',
    sql: `
      CREATE TABLE model_probe_cache (
        cache_key TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        model_key TEXT NOT NULL,
        metadata_hash TEXT NOT NULL,
        result_json TEXT NOT NULL,
        tested_at TEXT NOT NULL
      );
      CREATE INDEX idx_model_probe_lookup
        ON model_probe_cache(provider, endpoint, model_key, tested_at DESC);
    `,
  },
];

export function currentSchemaVersion(): number {
  return migrations.at(-1)?.version ?? 0;
}

export function runMigrations(database: Database.Database): void {
  const current = database.pragma('user_version', { simple: true }) as number;
  if (current > currentSchemaVersion()) {
    throw new Error(
      `Database schema ${current} is newer than supported schema ${currentSchemaVersion()}.`,
    );
  }

  const migrate = database.transaction(() => {
    for (const migration of migrations) {
      if (migration.version <= current) continue;
      database.exec(migration.sql);
      database.pragma(`user_version = ${migration.version}`);
    }
  });
  migrate();
}
