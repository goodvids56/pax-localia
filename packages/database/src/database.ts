import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  ActionSchema,
  AppSettingsSchema,
  BranchIdSchema,
  CommitmentSchema,
  ConversationSchema,
  DefaultSettings,
  EventIdSchema,
  EventSchema,
  GameSummarySchema,
  ScenarioSchema,
  TurnRecordSchema,
  WorldStateSchema,
  canonicalStringify,
  createId,
  type AppSettings,
  type BranchId,
  type BranchSummary,
  type Commitment,
  type Conversation,
  type ConversationId,
  type CreateGameInput,
  type DraftActionInput,
  type GameAction,
  type GameEvent,
  type GameId,
  type GameSummary,
  type GameView,
  type RewindInput,
  type Scenario,
  type ScenarioSummary,
  type SnapshotComparison,
  type TurnRecord,
  type WorldState,
} from '@pax-localia/domain';
import Database from 'better-sqlite3';
import pino, { type Logger } from 'pino';
import { currentSchemaVersion, runMigrations } from './migrations';

interface JsonRow {
  json: string;
}

interface GameRow {
  id: string;
  scenario_id: string;
  title: string;
  player_actor_id: string;
  active_branch_id: string;
  difficulty: string;
  provider: string;
  model: string;
  seed: number;
  created_at: string;
  updated_at: string;
}

interface BranchRow {
  id: string;
  game_id: string;
  parent_branch_id: string | null;
  branch_point_turn: number;
  label: string;
  current_turn: number;
  current_date: string;
  world_json: string;
  created_at: string;
  updated_at: string;
}

export interface CommitTurnInput {
  turn: TurnRecord;
  world: WorldState;
  events: GameEvent[];
  actions: GameAction[];
}

export interface PortableGameRows {
  schemaVersion: 1;
  game: Record<string, unknown>;
  branches: Record<string, unknown>[];
  turns: Record<string, unknown>[];
  snapshots: Record<string, unknown>[];
  actions: Record<string, unknown>[];
  events: Record<string, unknown>[];
  conversations: Record<string, unknown>[];
  messages: Record<string, unknown>[];
  memorySummaries: Record<string, unknown>[];
}

function now(): string {
  return new Date().toISOString();
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalStringify(value)).digest('hex');
}

function rowsAsRecords(rows: unknown[]): Record<string, unknown>[] {
  return rows.map((row) => ({ ...(row as Record<string, unknown>) }));
}

export class PaxDatabase {
  private database: Database.Database;
  private readonly logger: Logger;

  constructor(
    readonly filePath: string,
    logger: Logger = pino({ level: 'silent' }),
  ) {
    this.logger = logger.child({ component: 'database' });
    mkdirSync(path.dirname(filePath), { recursive: true });
    this.database = this.openDatabase();

    const existingVersion = this.database.pragma('user_version', { simple: true }) as number;
    if (
      existingVersion > 0 &&
      existingVersion < currentSchemaVersion() &&
      existsSync(filePath) &&
      statSync(filePath).size > 0
    ) {
      this.database.close();
      const backupPath = `${filePath}.pre-migration-v${existingVersion}-${Date.now()}.bak`;
      copyFileSync(filePath, backupPath);
      this.logger.info({ existingVersion, backupPath }, 'Created migration backup');
      this.database = this.openDatabase();
    }
    runMigrations(this.database);
  }

  private openDatabase(): Database.Database {
    const database = new Database(this.filePath);
    database.pragma('foreign_keys = ON');
    database.pragma('journal_mode = WAL');
    database.pragma('busy_timeout = 5000');
    database.pragma('synchronous = NORMAL');
    return database;
  }

  close(): void {
    if (this.database.open) this.database.close();
  }

  integrityCheck(): string[] {
    return (this.database.pragma('integrity_check') as { integrity_check: string }[]).map(
      (row) => row.integrity_check,
    );
  }

  getSettings(): AppSettings {
    const row = this.database
      .prepare('SELECT value_json FROM app_settings WHERE key = ?')
      .get('global') as { value_json: string } | undefined;
    if (!row) return structuredClone(DefaultSettings);
    return AppSettingsSchema.parse(JSON.parse(row.value_json));
  }

  saveSettings(settings: AppSettings): AppSettings {
    const parsed = AppSettingsSchema.parse(settings);
    this.database
      .prepare(
        `INSERT INTO app_settings(key, value_json, updated_at)
         VALUES ('global', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run(JSON.stringify(parsed), now());
    return parsed;
  }

  seedScenarios(scenarios: readonly Scenario[]): void {
    const insert = this.database.prepare(
      `INSERT INTO scenarios(id, source, version, title, json, created_at, updated_at)
       VALUES (?, 'bundled', ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         version = excluded.version,
         title = excluded.title,
         json = excluded.json,
         updated_at = excluded.updated_at
       WHERE scenarios.source = 'bundled'`,
    );
    const version = this.database.prepare(
      `INSERT OR IGNORE INTO scenario_versions(scenario_id, version, json, created_at)
       VALUES (?, ?, ?, ?)`,
    );
    this.database.transaction(() => {
      for (const candidate of scenarios) {
        const scenario = ScenarioSchema.parse(candidate);
        const timestamp = now();
        const json = JSON.stringify(scenario);
        insert.run(scenario.id, scenario.version, scenario.title, json, timestamp, timestamp);
        version.run(scenario.id, scenario.version, json, timestamp);
      }
    })();
  }

  listScenarios(): ScenarioSummary[] {
    const rows = this.database
      .prepare('SELECT json FROM scenarios ORDER BY title')
      .all() as JsonRow[];
    return rows.map((row) => {
      const scenario = ScenarioSchema.parse(JSON.parse(row.json));
      return {
        id: scenario.id,
        title: scenario.title,
        subtitle: scenario.subtitle,
        author: scenario.author,
        license: scenario.license,
        tags: scenario.tags,
        startDate: scenario.startDate,
        contentRating: scenario.contentRating,
        version: scenario.version,
        playableActors: Object.values(scenario.initialWorld.actors).filter(
          (actor) => actor.isPlayable && actor.isActive,
        ).length,
        compatibility: 'compatible',
      };
    });
  }

  getScenario(id: string): Scenario {
    const row = this.database.prepare('SELECT json FROM scenarios WHERE id = ?').get(id) as
      JsonRow | undefined;
    if (!row) throw new Error(`Scenario ${id} was not found.`);
    return ScenarioSchema.parse(JSON.parse(row.json));
  }

  saveScenario(candidate: Scenario, source: 'user' | 'imported' = 'user'): Scenario {
    const scenario = ScenarioSchema.parse(candidate);
    const timestamp = now();
    this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO scenarios(id, source, version, title, json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             source = excluded.source,
             version = excluded.version,
             title = excluded.title,
             json = excluded.json,
             updated_at = excluded.updated_at`,
        )
        .run(
          scenario.id,
          source,
          scenario.version,
          scenario.title,
          JSON.stringify(scenario),
          timestamp,
          timestamp,
        );
      this.database
        .prepare(
          `INSERT OR REPLACE INTO scenario_versions(scenario_id, version, json, created_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(scenario.id, scenario.version, JSON.stringify(scenario), timestamp);
    })();
    return scenario;
  }

  removeScenario(id: string): void {
    const row = this.database.prepare('SELECT source FROM scenarios WHERE id = ?').get(id) as
      { source: string } | undefined;
    if (!row) throw new Error(`Scenario ${id} was not found.`);
    if (row.source === 'bundled') throw new Error('Bundled scenarios cannot be removed.');
    const gameCount = this.database
      .prepare('SELECT COUNT(*) AS count FROM games WHERE scenario_id = ?')
      .get(id) as { count: number };
    if (gameCount.count > 0) throw new Error('A scenario used by a game cannot be removed.');
    this.database.prepare('DELETE FROM scenarios WHERE id = ?').run(id);
  }

  createGame(input: CreateGameInput, scenario: Scenario): GameView {
    const actor = scenario.initialWorld.actors[input.actorId];
    if (!actor?.isPlayable || !actor.isActive) {
      throw new Error('The selected actor is not playable.');
    }
    const gameId = createId<GameId>('game');
    const branchId = createId<BranchId>('branch');
    const timestamp = now();
    const world = WorldStateSchema.parse({
      ...structuredClone(scenario.initialWorld),
      scenarioId: scenario.id,
      gameId,
      branchId,
      playerActorId: input.actorId,
      rng: { seed: input.seed, step: 0 },
    });
    const events = scenario.seedEvents.map((event, index) =>
      EventSchema.parse({
        ...event,
        id: EventIdSchema.parse(`event:${gameId.slice(-16)}:seed:${index}`),
      }),
    );
    world.lastEventIds = events.map((event) => event.id);
    const hash = sha256(world);

    this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO games(
             id, scenario_id, title, player_actor_id, active_branch_id, difficulty,
             provider, model, seed, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          gameId,
          scenario.id,
          input.title,
          input.actorId,
          branchId,
          input.difficulty,
          input.provider,
          input.model,
          input.seed,
          timestamp,
          timestamp,
        );
      this.database
        .prepare(
          `INSERT INTO branches(
             id, game_id, parent_branch_id, branch_point_turn, label, current_turn,
             current_date, world_json, created_at, updated_at
           ) VALUES (?, ?, NULL, 0, 'Original timeline', 0, ?, ?, ?, ?)`,
        )
        .run(branchId, gameId, world.date, JSON.stringify(world), timestamp, timestamp);
      this.database
        .prepare(
          `INSERT INTO snapshots(
             game_id, branch_id, turn_number, in_world_date, world_json, canonical_hash, created_at
           ) VALUES (?, ?, 0, ?, ?, ?, ?)`,
        )
        .run(gameId, branchId, world.date, JSON.stringify(world), hash, timestamp);
      const eventStatement = this.database.prepare(
        `INSERT INTO events(
           id, game_id, branch_id, turn_number, in_world_date, category, severity,
           actor_ids, region_ids, json
         ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
      );
      for (const event of events) {
        eventStatement.run(
          event.id,
          gameId,
          branchId,
          event.date,
          event.category,
          event.severity,
          JSON.stringify(event.actorIds),
          JSON.stringify(event.regionIds),
          JSON.stringify(event),
        );
      }
      this.replaceProjections(gameId, branchId, world);
    })();
    return this.loadGame(gameId);
  }

  listGames(): GameSummary[] {
    const rows = this.database
      .prepare(
        `SELECT g.*, b.label AS branch_label, b.current_turn, b.current_date, b.world_json
         FROM games g
         JOIN branches b ON b.id = g.active_branch_id
         ORDER BY g.updated_at DESC`,
      )
      .all() as (GameRow & {
      branch_label: string;
      current_turn: number;
      current_date: string;
      world_json: string;
    })[];
    return rows.map((row) => {
      const world = WorldStateSchema.parse(JSON.parse(row.world_json));
      return GameSummarySchema.parse({
        id: row.id,
        scenarioId: row.scenario_id,
        title: row.title,
        actorName: world.actors[world.playerActorId]?.name ?? world.playerActorId,
        branchId: row.active_branch_id,
        branchLabel: row.branch_label,
        date: row.current_date,
        turnNumber: row.current_turn,
        updatedAt: row.updated_at,
      });
    });
  }

  getGameMetadata(id: GameId): GameRow {
    const row = this.database.prepare('SELECT * FROM games WHERE id = ?').get(id) as
      GameRow | undefined;
    if (!row) throw new Error(`Game ${id} was not found.`);
    return row;
  }

  getWorld(gameId: GameId, branchId?: BranchId): WorldState {
    const game = this.getGameMetadata(gameId);
    const selectedBranch = branchId ?? BranchIdSchema.parse(game.active_branch_id);
    const row = this.database
      .prepare('SELECT world_json FROM branches WHERE id = ? AND game_id = ?')
      .get(selectedBranch, gameId) as { world_json: string } | undefined;
    if (!row) throw new Error(`Branch ${selectedBranch} was not found.`);
    return WorldStateSchema.parse(JSON.parse(row.world_json));
  }

  loadGame(id: GameId): GameView {
    const game = this.getGameMetadata(id);
    const branchId = BranchIdSchema.parse(game.active_branch_id);
    const world = this.getWorld(id, branchId);
    const actions = this.listActions(id, branchId);
    const events = this.listEvents(id, branchId);
    const conversations = this.listConversations(id, branchId);
    const branches = this.listBranches(id);
    const branch = branches.find((candidate) => candidate.id === branchId);
    if (!branch) throw new Error('The active branch is missing.');
    const summary = GameSummarySchema.parse({
      id,
      scenarioId: game.scenario_id,
      title: game.title,
      actorName: world.actors[world.playerActorId]?.name ?? world.playerActorId,
      branchId,
      branchLabel: branch.label,
      date: world.date,
      turnNumber: world.turnNumber,
      updatedAt: game.updated_at,
    });
    return { summary, world, actions, events, conversations, branches };
  }

  renameGame(gameId: GameId, title: string): GameSummary {
    const parsedTitle = title.trim();
    if (!parsedTitle || parsedTitle.length > 160) throw new Error('Invalid game title.');
    this.database
      .prepare('UPDATE games SET title = ?, updated_at = ? WHERE id = ?')
      .run(parsedTitle, now(), gameId);
    return this.listGames().find((game) => game.id === gameId) as GameSummary;
  }

  deleteGame(gameId: GameId): void {
    const result = this.database.prepare('DELETE FROM games WHERE id = ?').run(gameId);
    if (result.changes === 0) throw new Error(`Game ${gameId} was not found.`);
  }

  listActions(gameId: GameId, branchId: BranchId): GameAction[] {
    const rows = this.database
      .prepare(
        `SELECT json FROM actions
         WHERE game_id = ? AND branch_id = ?
         ORDER BY CASE status WHEN 'draft' THEN 0 WHEN 'submitted' THEN 1 ELSE 2 END,
                  sort_order, created_at`,
      )
      .all(gameId, branchId) as JsonRow[];
    return rows.map((row) => ActionSchema.parse(JSON.parse(row.json)));
  }

  saveAction(input: DraftActionInput): GameAction[] {
    const world = this.getWorld(input.gameId, input.branchId);
    const existing = input.id
      ? (this.database
          .prepare('SELECT json FROM actions WHERE id = ? AND game_id = ? AND branch_id = ?')
          .get(input.id, input.gameId, input.branchId) as JsonRow | undefined)
      : undefined;
    const previous = existing ? ActionSchema.parse(JSON.parse(existing.json)) : undefined;
    if (previous && previous.status !== 'draft') {
      throw new Error('Only draft actions can be edited.');
    }
    const orderRow = this.database
      .prepare(
        `SELECT COALESCE(MAX(sort_order), -1) AS value FROM actions
         WHERE game_id = ? AND branch_id = ? AND status = 'draft'`,
      )
      .get(input.gameId, input.branchId) as { value: number };
    const timestamp = now();
    const action = ActionSchema.parse({
      id: input.id ?? createId('action'),
      gameId: input.gameId,
      branchId: input.branchId,
      actorId: world.playerActorId,
      status: 'draft',
      originalText: input.text,
      targetActorIds: input.targetActorIds,
      targetRegionIds: input.targetRegionIds,
      classification: input.classification,
      priority: input.priority,
      effort: input.effort,
      ...(input.scheduledDate ? { scheduledDate: input.scheduledDate } : {}),
      order: previous?.order ?? orderRow.value + 1,
      createdAt: previous?.createdAt ?? timestamp,
    });
    this.database
      .prepare(
        `INSERT INTO actions(
           id, game_id, branch_id, status, sort_order, actor_id, json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           sort_order = excluded.sort_order,
           json = excluded.json,
           updated_at = excluded.updated_at`,
      )
      .run(
        action.id,
        action.gameId,
        action.branchId,
        action.status,
        action.order,
        action.actorId,
        JSON.stringify(action),
        action.createdAt,
        timestamp,
      );
    return this.listActions(input.gameId, input.branchId);
  }

  removeAction(gameId: GameId, branchId: BranchId, actionId: string): GameAction[] {
    const result = this.database
      .prepare(
        `DELETE FROM actions
         WHERE id = ? AND game_id = ? AND branch_id = ? AND status = 'draft'`,
      )
      .run(actionId, gameId, branchId);
    if (result.changes === 0) throw new Error('Draft action was not found.');
    return this.listActions(gameId, branchId);
  }

  reorderActions(gameId: GameId, branchId: BranchId, actionIds: readonly string[]): GameAction[] {
    const drafts = this.listActions(gameId, branchId).filter((action) => action.status === 'draft');
    const expected = new Set(drafts.map((action) => action.id));
    if (
      expected.size !== actionIds.length ||
      actionIds.some((actionId) => !expected.has(actionId as GameAction['id']))
    ) {
      throw new Error('Reorder request must contain every draft action exactly once.');
    }
    const update = this.database.prepare(
      `UPDATE actions SET sort_order = ?, json = ?, updated_at = ?
       WHERE id = ? AND game_id = ? AND branch_id = ? AND status = 'draft'`,
    );
    this.database.transaction(() => {
      actionIds.forEach((actionId, order) => {
        const action = drafts.find((candidate) => candidate.id === actionId);
        if (!action) return;
        action.order = order;
        update.run(order, JSON.stringify(action), now(), actionId, gameId, branchId);
      });
    })();
    return this.listActions(gameId, branchId);
  }

  listEvents(gameId: GameId, branchId: BranchId): GameEvent[] {
    const rows = this.database
      .prepare(
        `SELECT json FROM events
         WHERE game_id = ? AND branch_id = ?
         ORDER BY in_world_date DESC, severity DESC, rowid DESC`,
      )
      .all(gameId, branchId) as JsonRow[];
    return rows.map((row) => EventSchema.parse(JSON.parse(row.json)));
  }

  commitTurn(input: CommitTurnInput): void {
    const turn = TurnRecordSchema.parse(input.turn);
    const world = WorldStateSchema.parse(input.world);
    if (
      turn.gameId !== world.gameId ||
      turn.branchId !== world.branchId ||
      turn.sequence !== world.turnNumber
    ) {
      throw new Error('Turn and world state identity do not match.');
    }
    const previous = this.getWorld(turn.gameId, turn.branchId);
    if (previous.turnNumber + 1 !== world.turnNumber) {
      throw new Error('Turn sequence does not immediately follow the current snapshot.');
    }
    const hash = sha256(world);
    if (hash !== turn.snapshotHash) {
      throw new Error('Turn snapshot hash does not match the world state.');
    }
    const timestamp = now();
    this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO turns(
             id, game_id, branch_id, sequence, start_date, end_date, status,
             record_json, created_at, completed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          turn.id,
          turn.gameId,
          turn.branchId,
          turn.sequence,
          turn.startDate,
          turn.endDate,
          turn.status,
          JSON.stringify(turn),
          turn.createdAt,
          turn.completedAt ?? timestamp,
        );
      this.database
        .prepare(
          `UPDATE branches SET
             current_turn = ?, current_date = ?, world_json = ?, updated_at = ?
           WHERE id = ? AND game_id = ?`,
        )
        .run(
          world.turnNumber,
          world.date,
          JSON.stringify(world),
          timestamp,
          world.branchId,
          world.gameId,
        );
      this.database
        .prepare(
          `INSERT INTO snapshots(
             game_id, branch_id, turn_number, in_world_date, world_json, canonical_hash, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          world.gameId,
          world.branchId,
          world.turnNumber,
          world.date,
          JSON.stringify(world),
          hash,
          timestamp,
        );
      const insertEvent = this.database.prepare(
        `INSERT INTO events(
           id, game_id, branch_id, turn_number, in_world_date, category, severity,
           actor_ids, region_ids, json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const event of input.events) {
        const parsed = EventSchema.parse(event);
        insertEvent.run(
          parsed.id,
          world.gameId,
          world.branchId,
          world.turnNumber,
          parsed.date,
          parsed.category,
          parsed.severity,
          JSON.stringify(parsed.actorIds),
          JSON.stringify(parsed.regionIds),
          JSON.stringify(parsed),
        );
      }
      const updateAction = this.database.prepare(
        `UPDATE actions SET status = ?, json = ?, updated_at = ?
         WHERE id = ? AND game_id = ? AND branch_id = ?`,
      );
      for (const action of input.actions) {
        const parsed = ActionSchema.parse(action);
        updateAction.run(
          parsed.status,
          JSON.stringify(parsed),
          timestamp,
          parsed.id,
          parsed.gameId,
          parsed.branchId,
        );
      }
      this.replaceProjections(world.gameId, world.branchId, world);
      this.database
        .prepare('UPDATE games SET updated_at = ? WHERE id = ?')
        .run(timestamp, world.gameId);
    })();
  }

  listConversations(gameId: GameId, branchId: BranchId): Conversation[] {
    const rows = this.database
      .prepare(
        `SELECT json FROM conversations
         WHERE game_id = ? AND branch_id = ?
         ORDER BY archived, updated_date DESC`,
      )
      .all(gameId, branchId) as JsonRow[];
    return rows.map((row) => ConversationSchema.parse(JSON.parse(row.json)));
  }

  getConversation(id: ConversationId): Conversation | undefined {
    const row = this.database.prepare('SELECT json FROM conversations WHERE id = ?').get(id) as
      JsonRow | undefined;
    return row ? ConversationSchema.parse(JSON.parse(row.json)) : undefined;
  }

  saveConversation(candidate: Conversation): Conversation {
    const conversation = ConversationSchema.parse(candidate);
    const save = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO conversations(
             id, game_id, branch_id, type, title, archived, updated_date, json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             title = excluded.title,
             archived = excluded.archived,
             updated_date = excluded.updated_date,
             json = excluded.json`,
        )
        .run(
          conversation.id,
          conversation.gameId,
          conversation.branchId,
          conversation.type,
          conversation.title,
          conversation.archived ? 1 : 0,
          conversation.updatedDate,
          JSON.stringify(conversation),
        );
      const insertMessage = this.database.prepare(
        `INSERT OR IGNORE INTO messages(
           id, conversation_id, speaker_actor_id, in_world_date, created_at, json
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const message of conversation.messages) {
        insertMessage.run(
          message.id,
          conversation.id,
          message.speakerActorId ?? null,
          message.date,
          message.createdAt,
          JSON.stringify(message),
        );
      }
    });
    save();
    return conversation;
  }

  addCommitment(gameId: GameId, branchId: BranchId, candidate: Commitment): WorldState {
    const commitment = CommitmentSchema.parse(candidate);
    const world = this.getWorld(gameId, branchId);
    if (world.commitments.some((entry) => entry.id === commitment.id)) {
      throw new Error(`Commitment ${commitment.id} already exists.`);
    }
    world.commitments.push(commitment);
    this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO commitments(
             id, game_id, branch_id, status, from_actor_id, json
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          commitment.id,
          gameId,
          branchId,
          commitment.status,
          commitment.fromActorId,
          JSON.stringify(commitment),
        );
      this.database
        .prepare(
          `UPDATE branches SET world_json = ?, updated_at = ?
           WHERE id = ? AND game_id = ?`,
        )
        .run(JSON.stringify(world), now(), branchId, gameId);
      this.database.prepare('UPDATE games SET updated_at = ? WHERE id = ?').run(now(), gameId);
    })();
    return world;
  }

  listBranches(gameId: GameId): BranchSummary[] {
    const rows = this.database
      .prepare('SELECT * FROM branches WHERE game_id = ? ORDER BY created_at')
      .all(gameId) as BranchRow[];
    return rows.map((row) => ({
      id: BranchIdSchema.parse(row.id),
      gameId,
      ...(row.parent_branch_id
        ? { parentBranchId: BranchIdSchema.parse(row.parent_branch_id) }
        : {}),
      branchPointTurn: row.branch_point_turn,
      label: row.label,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      turnCount: row.current_turn,
      date: WorldStateSchema.parse(JSON.parse(row.world_json)).date,
    }));
  }

  rewind(input: RewindInput): GameView {
    const snapshot = this.database
      .prepare(
        `SELECT world_json, in_world_date FROM snapshots
         WHERE game_id = ? AND branch_id = ? AND turn_number = ?`,
      )
      .get(input.gameId, input.sourceBranchId, input.turnNumber) as
      { world_json: string; in_world_date: string } | undefined;
    if (!snapshot) throw new Error('The selected snapshot was not found.');
    const branchId = createId<BranchId>('branch');
    const timestamp = now();
    const world = WorldStateSchema.parse({
      ...JSON.parse(snapshot.world_json),
      branchId,
    });
    const hash = sha256(world);

    this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO branches(
             id, game_id, parent_branch_id, branch_point_turn, label, current_turn,
             current_date, world_json, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          branchId,
          input.gameId,
          input.sourceBranchId,
          input.turnNumber,
          input.label,
          input.turnNumber,
          snapshot.in_world_date,
          JSON.stringify(world),
          timestamp,
          timestamp,
        );
      this.database
        .prepare(
          `INSERT INTO snapshots(
             game_id, branch_id, turn_number, in_world_date, world_json, canonical_hash, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.gameId,
          branchId,
          input.turnNumber,
          snapshot.in_world_date,
          JSON.stringify(world),
          hash,
          timestamp,
        );

      const sourceEvents = this.database
        .prepare(
          `SELECT json FROM events
           WHERE game_id = ? AND branch_id = ? AND turn_number <= ? ORDER BY rowid`,
        )
        .all(input.gameId, input.sourceBranchId, input.turnNumber) as JsonRow[];
      const insertEvent = this.database.prepare(
        `INSERT INTO events(
           id, game_id, branch_id, turn_number, in_world_date, category, severity,
           actor_ids, region_ids, json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const remappedIds: string[] = [];
      sourceEvents.forEach((row, index) => {
        const source = EventSchema.parse(JSON.parse(row.json));
        const id = EventIdSchema.parse(`event:${branchId.slice(-16)}:history:${index}`);
        remappedIds.push(id);
        const event = EventSchema.parse({ ...source, id });
        const turnNumber =
          source.turnId === undefined ? 0 : Math.min(input.turnNumber, Math.max(1, index));
        insertEvent.run(
          id,
          input.gameId,
          branchId,
          turnNumber,
          event.date,
          event.category,
          event.severity,
          JSON.stringify(event.actorIds),
          JSON.stringify(event.regionIds),
          JSON.stringify(event),
        );
      });
      world.lastEventIds = remappedIds.slice(-100).map((id) => EventIdSchema.parse(id));
      this.database
        .prepare('UPDATE branches SET world_json = ? WHERE id = ?')
        .run(JSON.stringify(world), branchId);
      this.replaceProjections(input.gameId, branchId, world);
      this.database
        .prepare('UPDATE games SET active_branch_id = ?, updated_at = ? WHERE id = ?')
        .run(branchId, timestamp, input.gameId);
    })();
    return this.loadGame(input.gameId);
  }

  compareBranches(
    gameId: GameId,
    leftBranchId: BranchId,
    rightBranchId: BranchId,
  ): SnapshotComparison {
    const left = this.getWorld(gameId, leftBranchId);
    const right = this.getWorld(gameId, rightBranchId);
    const territoryChanges: SnapshotComparison['territoryChanges'] = [];
    for (const region of Object.values(left.regions)) {
      const other = right.regions[region.id];
      if (!other || region.ownerId === other.ownerId) continue;
      territoryChanges.push({
        regionId: region.id,
        regionName: region.name,
        leftOwner: region.ownerId ? (left.actors[region.ownerId]?.name ?? region.ownerId) : 'None',
        rightOwner: other.ownerId ? (right.actors[other.ownerId]?.name ?? other.ownerId) : 'None',
      });
    }
    const statChanges: SnapshotComparison['statChanges'] = [];
    for (const actor of Object.values(left.actors)) {
      const other = right.actors[actor.id];
      if (!other) continue;
      for (const stat of Object.keys(actor.stats) as (keyof typeof actor.stats)[]) {
        if (actor.stats[stat] !== other.stats[stat]) {
          statChanges.push({
            actorId: actor.id,
            actorName: actor.name,
            stat,
            left: actor.stats[stat],
            right: other.stats[stat],
          });
        }
      }
    }
    const leftTreaties = new Set(left.treaties.map((treaty) => `${treaty.name}: ${treaty.status}`));
    const rightTreaties = new Set(
      right.treaties.map((treaty) => `${treaty.name}: ${treaty.status}`),
    );
    const leftConflicts = new Set(
      left.conflicts.map((conflict) => `${conflict.name}: ${conflict.status}`),
    );
    const rightConflicts = new Set(
      right.conflicts.map((conflict) => `${conflict.name}: ${conflict.status}`),
    );
    return {
      leftBranchId,
      rightBranchId,
      territoryChanges,
      statChanges,
      treatyChanges: [...leftTreaties, ...rightTreaties].filter(
        (entry) => leftTreaties.has(entry) !== rightTreaties.has(entry),
      ),
      conflictChanges: [...leftConflicts, ...rightConflicts].filter(
        (entry) => leftConflicts.has(entry) !== rightConflicts.has(entry),
      ),
    };
  }

  exportGameRows(gameId: GameId): PortableGameRows {
    const game = this.getGameMetadata(gameId);
    const select = (table: string): Record<string, unknown>[] =>
      rowsAsRecords(this.database.prepare(`SELECT * FROM ${table} WHERE game_id = ?`).all(gameId));
    const conversations = select('conversations');
    const conversationIds = conversations
      .map((row) => row.id)
      .filter((id): id is string => typeof id === 'string');
    const messages =
      conversationIds.length === 0
        ? []
        : rowsAsRecords(
            this.database
              .prepare(
                `SELECT * FROM messages
                 WHERE conversation_id IN (${conversationIds.map(() => '?').join(',')})`,
              )
              .all(...conversationIds),
          );
    return {
      schemaVersion: 1,
      game: { ...game },
      branches: select('branches'),
      turns: select('turns'),
      snapshots: select('snapshots'),
      actions: select('actions'),
      events: select('events'),
      conversations,
      messages,
      memorySummaries: select('memory_summaries'),
    };
  }

  importGameRows(input: PortableGameRows): GameId {
    if (input.schemaVersion !== 1) throw new Error('Unsupported portable save schema version.');
    const gameId = GameSummarySchema.shape.id.parse(input.game.id);
    const scenarioId = ScenarioSchema.shape.id.parse(input.game.scenario_id);
    this.getScenario(scenarioId);
    const existing = this.database
      .prepare('SELECT 1 AS found FROM games WHERE id = ?')
      .get(gameId) as { found: number } | undefined;
    if (existing) {
      throw new Error(
        'A game with this ID already exists. Delete it or export from the source as a distinct branch.',
      );
    }

    const branchWorlds = new Map<string, WorldState>();
    for (const row of input.branches) {
      if (typeof row.id !== 'string' || typeof row.world_json !== 'string') {
        throw new Error('Imported branch row is malformed.');
      }
      const world = WorldStateSchema.parse(JSON.parse(row.world_json));
      if (world.gameId !== gameId || world.branchId !== row.id) {
        throw new Error('Imported branch world identity does not match its row.');
      }
      branchWorlds.set(row.id, world);
    }
    if (
      typeof input.game.active_branch_id !== 'string' ||
      !branchWorlds.has(input.game.active_branch_id)
    ) {
      throw new Error('Imported game has no valid active branch.');
    }

    input.snapshots.forEach((row) => {
      if (typeof row.world_json !== 'string' || typeof row.canonical_hash !== 'string') {
        throw new Error('Imported snapshot row is malformed.');
      }
      const world = WorldStateSchema.parse(JSON.parse(row.world_json));
      if (sha256(world) !== row.canonical_hash) {
        throw new Error('Imported snapshot failed its canonical hash check.');
      }
    });
    input.turns.forEach((row) => {
      if (typeof row.record_json !== 'string') throw new Error('Imported turn row is malformed.');
      TurnRecordSchema.parse(JSON.parse(row.record_json));
    });
    input.actions.forEach((row) => {
      if (typeof row.json !== 'string') throw new Error('Imported action row is malformed.');
      ActionSchema.parse(JSON.parse(row.json));
    });
    input.events.forEach((row) => {
      if (typeof row.json !== 'string') throw new Error('Imported event row is malformed.');
      EventSchema.parse(JSON.parse(row.json));
    });
    input.conversations.forEach((row) => {
      if (typeof row.json !== 'string') {
        throw new Error('Imported conversation row is malformed.');
      }
      ConversationSchema.parse(JSON.parse(row.json));
    });

    const text = (row: Record<string, unknown>, key: string): string => {
      const value = row[key];
      if (typeof value !== 'string') throw new Error(`Imported row has invalid ${key}.`);
      return value;
    };
    const integer = (row: Record<string, unknown>, key: string): number => {
      const value = row[key];
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new Error(`Imported row has invalid ${key}.`);
      }
      return value;
    };
    const nullableText = (row: Record<string, unknown>, key: string): string | null => {
      const value = row[key];
      if (value === null) return null;
      return text(row, key);
    };

    this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO games(
             id, scenario_id, title, player_actor_id, active_branch_id, difficulty,
             provider, model, seed, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          gameId,
          scenarioId,
          text(input.game, 'title'),
          text(input.game, 'player_actor_id'),
          text(input.game, 'active_branch_id'),
          text(input.game, 'difficulty'),
          text(input.game, 'provider'),
          text(input.game, 'model'),
          integer(input.game, 'seed'),
          text(input.game, 'created_at'),
          text(input.game, 'updated_at'),
        );
      const insertBranch = this.database.prepare(
        `INSERT INTO branches(
           id, game_id, parent_branch_id, branch_point_turn, label, current_turn,
           current_date, world_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const pendingBranches = [...input.branches];
      const inserted = new Set<string>();
      while (pendingBranches.length > 0) {
        const index = pendingBranches.findIndex((row) => {
          const parent = row.parent_branch_id;
          return parent === null || (typeof parent === 'string' && inserted.has(parent));
        });
        if (index < 0) throw new Error('Imported branch parent graph is invalid.');
        const [row] = pendingBranches.splice(index, 1);
        if (!row) continue;
        const id = text(row, 'id');
        insertBranch.run(
          id,
          gameId,
          nullableText(row, 'parent_branch_id'),
          integer(row, 'branch_point_turn'),
          text(row, 'label'),
          integer(row, 'current_turn'),
          text(row, 'current_date'),
          text(row, 'world_json'),
          text(row, 'created_at'),
          text(row, 'updated_at'),
        );
        inserted.add(id);
      }

      const insertTurn = this.database.prepare(
        `INSERT INTO turns(
           id, game_id, branch_id, sequence, start_date, end_date, status,
           record_json, created_at, completed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      input.turns.forEach((row) =>
        insertTurn.run(
          text(row, 'id'),
          gameId,
          text(row, 'branch_id'),
          integer(row, 'sequence'),
          text(row, 'start_date'),
          text(row, 'end_date'),
          text(row, 'status'),
          text(row, 'record_json'),
          text(row, 'created_at'),
          nullableText(row, 'completed_at'),
        ),
      );
      const insertSnapshot = this.database.prepare(
        `INSERT INTO snapshots(
           game_id, branch_id, turn_number, in_world_date, world_json, canonical_hash, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      input.snapshots.forEach((row) =>
        insertSnapshot.run(
          gameId,
          text(row, 'branch_id'),
          integer(row, 'turn_number'),
          text(row, 'in_world_date'),
          text(row, 'world_json'),
          text(row, 'canonical_hash'),
          text(row, 'created_at'),
        ),
      );
      const insertAction = this.database.prepare(
        `INSERT INTO actions(
           id, game_id, branch_id, status, sort_order, actor_id, json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      input.actions.forEach((row) =>
        insertAction.run(
          text(row, 'id'),
          gameId,
          text(row, 'branch_id'),
          text(row, 'status'),
          integer(row, 'sort_order'),
          text(row, 'actor_id'),
          text(row, 'json'),
          text(row, 'created_at'),
          text(row, 'updated_at'),
        ),
      );
      const insertEvent = this.database.prepare(
        `INSERT INTO events(
           id, game_id, branch_id, turn_number, in_world_date, category, severity,
           actor_ids, region_ids, json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      input.events.forEach((row) =>
        insertEvent.run(
          text(row, 'id'),
          gameId,
          text(row, 'branch_id'),
          integer(row, 'turn_number'),
          text(row, 'in_world_date'),
          text(row, 'category'),
          integer(row, 'severity'),
          text(row, 'actor_ids'),
          text(row, 'region_ids'),
          text(row, 'json'),
        ),
      );
      const insertConversation = this.database.prepare(
        `INSERT INTO conversations(
           id, game_id, branch_id, type, title, archived, updated_date, json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      input.conversations.forEach((row) =>
        insertConversation.run(
          text(row, 'id'),
          gameId,
          text(row, 'branch_id'),
          text(row, 'type'),
          text(row, 'title'),
          integer(row, 'archived'),
          text(row, 'updated_date'),
          text(row, 'json'),
        ),
      );
      const insertMessage = this.database.prepare(
        `INSERT INTO messages(
           id, conversation_id, speaker_actor_id, in_world_date, created_at, json
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      );
      input.messages.forEach((row) =>
        insertMessage.run(
          text(row, 'id'),
          text(row, 'conversation_id'),
          nullableText(row, 'speaker_actor_id'),
          text(row, 'in_world_date'),
          text(row, 'created_at'),
          text(row, 'json'),
        ),
      );
      const insertMemory = this.database.prepare(
        `INSERT INTO memory_summaries(
           id, game_id, branch_id, kind, start_turn, end_turn,
           event_ids, facts_json, summary, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      input.memorySummaries.forEach((row) =>
        insertMemory.run(
          text(row, 'id'),
          gameId,
          text(row, 'branch_id'),
          text(row, 'kind'),
          integer(row, 'start_turn'),
          integer(row, 'end_turn'),
          text(row, 'event_ids'),
          text(row, 'facts_json'),
          text(row, 'summary'),
          text(row, 'created_at'),
        ),
      );
      for (const [branchId, world] of branchWorlds) {
        this.replaceProjections(gameId, BranchIdSchema.parse(branchId), world);
      }
    })();
    return gameId;
  }

  clearUserData(): void {
    this.database.transaction(() => {
      this.database.exec(`
        DELETE FROM games;
        DELETE FROM scenarios WHERE source <> 'bundled';
        DELETE FROM import_history;
        DELETE FROM model_probe_cache;
        DELETE FROM ai_requests;
        DELETE FROM app_settings;
      `);
    })();
    this.database.pragma('wal_checkpoint(TRUNCATE)');
  }

  getProbeCache(cacheKey: string): unknown | undefined {
    const row = this.database
      .prepare('SELECT result_json FROM model_probe_cache WHERE cache_key = ?')
      .get(cacheKey) as { result_json: string } | undefined;
    return row ? JSON.parse(row.result_json) : undefined;
  }

  saveProbeCache(
    cacheKey: string,
    provider: string,
    endpoint: string,
    modelKey: string,
    metadataHash: string,
    result: unknown,
  ): void {
    this.database
      .prepare(
        `INSERT OR REPLACE INTO model_probe_cache(
           cache_key, provider, endpoint, model_key, metadata_hash, result_json, tested_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(cacheKey, provider, endpoint, modelKey, metadataHash, JSON.stringify(result), now());
  }

  private replaceProjections(gameId: GameId, branchId: BranchId, world: WorldState): void {
    for (const table of [
      'actors',
      'regions',
      'cities',
      'military_units',
      'relationships',
      'treaties',
      'conflicts',
      'commitments',
    ]) {
      this.database
        .prepare(`DELETE FROM ${table} WHERE game_id = ? AND branch_id = ?`)
        .run(gameId, branchId);
    }
    const actorStatement = this.database.prepare(
      'INSERT INTO actors(game_id, branch_id, id, active, json) VALUES (?, ?, ?, ?, ?)',
    );
    Object.values(world.actors).forEach((actor) => {
      actorStatement.run(gameId, branchId, actor.id, actor.isActive ? 1 : 0, JSON.stringify(actor));
    });
    const regionStatement = this.database.prepare(
      `INSERT INTO regions(
         game_id, branch_id, id, owner_actor_id, controller_actor_id, json
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    Object.values(world.regions).forEach((region) => {
      regionStatement.run(
        gameId,
        branchId,
        region.id,
        region.ownerId ?? null,
        region.controllerId ?? null,
        JSON.stringify(region),
      );
    });
    const cityStatement = this.database.prepare(
      `INSERT INTO cities(
         game_id, branch_id, id, region_id, controller_actor_id, json
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    Object.values(world.cities).forEach((city) => {
      cityStatement.run(
        gameId,
        branchId,
        city.id,
        city.regionId,
        city.controllerId ?? null,
        JSON.stringify(city),
      );
    });
    const unitStatement = this.database.prepare(
      `INSERT INTO military_units(
         game_id, branch_id, id, actor_id, region_id, json
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    Object.values(world.units).forEach((unit) => {
      unitStatement.run(
        gameId,
        branchId,
        unit.id,
        unit.actorId,
        unit.regionId,
        JSON.stringify(unit),
      );
    });
    const relationshipStatement = this.database.prepare(
      `INSERT INTO relationships(
         game_id, branch_id, from_actor_id, to_actor_id, score, json
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    world.relationships.forEach((relationship) => {
      relationshipStatement.run(
        gameId,
        branchId,
        relationship.fromActorId,
        relationship.toActorId,
        relationship.score,
        JSON.stringify(relationship),
      );
    });
    const treatyStatement = this.database.prepare(
      `INSERT INTO treaties(game_id, branch_id, id, status, json) VALUES (?, ?, ?, ?, ?)`,
    );
    world.treaties.forEach((treaty) => {
      treatyStatement.run(gameId, branchId, treaty.id, treaty.status, JSON.stringify(treaty));
    });
    const conflictStatement = this.database.prepare(
      `INSERT INTO conflicts(game_id, branch_id, id, status, json) VALUES (?, ?, ?, ?, ?)`,
    );
    world.conflicts.forEach((conflict) => {
      conflictStatement.run(
        gameId,
        branchId,
        conflict.id,
        conflict.status,
        JSON.stringify(conflict),
      );
    });
    const commitmentStatement = this.database.prepare(
      `INSERT INTO commitments(
         id, game_id, branch_id, status, from_actor_id, json
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    world.commitments.forEach((commitment) => {
      commitmentStatement.run(
        commitment.id,
        gameId,
        branchId,
        commitment.status,
        commitment.fromActorId,
        JSON.stringify(commitment),
      );
    });
  }
}
