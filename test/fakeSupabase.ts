// A small in-memory fake of the pieces of the supabase-js client the API
// routes actually use: `.from(table).select(...).eq(...).order(...)
// .limit(...).maybeSingle()`, and `.rpc(fn, args)`. The four RPCs
// (create_game/join_game/start_game/apply_game_action) are reimplemented
// here against plain in-memory tables, mirroring exactly what
// supabase/migrations/0002_game_secrets_and_rpcs.sql does — so tests
// exercise the real request/response flow, not just "was rpc called".

/* eslint-disable @typescript-eslint/no-explicit-any */

interface FakeResult<T> {
  data: T;
  error: { code?: string; message: string } | null;
}

class FakeQueryBuilder<T extends Record<string, any>> {
  private filters: ((row: T) => boolean)[] = [];
  private sortField: string | null = null;
  private sortAscending = true;
  private limitCount: number | null = null;

  constructor(private rows: T[]) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for call-site parity with supabase-js
  select(columns: string): this {
    return this;
  }

  eq(field: string, value: unknown): this {
    this.filters.push((row) => row[field] === value);
    return this;
  }

  order(field: string, opts?: { ascending?: boolean }): this {
    this.sortField = field;
    this.sortAscending = opts?.ascending ?? true;
    return this;
  }

  limit(n: number): this {
    this.limitCount = n;
    return this;
  }

  private materialize(): T[] {
    let result = this.rows.filter((row) => this.filters.every((f) => f(row)));
    if (this.sortField) {
      const field = this.sortField;
      const dir = this.sortAscending ? 1 : -1;
      result = [...result].sort((a, b) => (a[field] > b[field] ? dir : a[field] < b[field] ? -dir : 0));
    }
    if (this.limitCount !== null) result = result.slice(0, this.limitCount);
    return result;
  }

  async maybeSingle(): Promise<FakeResult<T | null>> {
    const rows = this.materialize();
    return { data: rows[0] ?? null, error: null };
  }

  then<TResult1 = FakeResult<T[]>, TResult2 = never>(
    onfulfilled?: ((value: FakeResult<T[]>) => TResult1 | PromiseLike<TResult1>) | null,
  ): Promise<TResult1 | TResult2> {
    const result: FakeResult<T[]> = { data: this.materialize(), error: null };
    return Promise.resolve(result).then(onfulfilled as any);
  }
}

export interface FakeDb {
  games: any[];
  gameSecrets: any[];
  players: any[];
  playerSecrets: any[];
  rolls: any[];
  events: any[];
}

function emptyDb(): FakeDb {
  return { games: [], gameSecrets: [], players: [], playerSecrets: [], rolls: [], events: [] };
}

export class FakeSupabaseAdmin {
  db: FakeDb = emptyDb();

  reset(): void {
    this.db = emptyDb();
  }

  from(table: string): FakeQueryBuilder<any> {
    if (table === "games_public") {
      const rows = this.db.games.map((g) => {
        const secrets = this.db.gameSecrets.find((s) => s.game_id === g.id);
        return {
          id: g.id,
          room_code: g.room_code,
          status: g.status,
          server_seed_hash: g.server_seed_hash,
          server_seed: g.status === "finished" ? (secrets?.server_seed ?? null) : null,
          roll_index: g.roll_index,
          current_player_index: g.current_player_index,
          turn_phase: g.turn_phase,
          doubles_count: g.doubles_count,
          state: g.state,
          created_at: g.created_at,
          updated_at: g.updated_at,
        };
      });
      return new FakeQueryBuilder(rows);
    }

    const tableMap: Record<string, any[]> = {
      games: this.db.games,
      game_secrets: this.db.gameSecrets,
      players: this.db.players,
      player_secrets: this.db.playerSecrets,
      rolls: this.db.rolls,
      events: this.db.events,
    };
    const rows = tableMap[table];
    if (!rows) throw new Error(`fake supabase: unknown table "${table}"`);
    return new FakeQueryBuilder([...rows]);
  }

  async rpc(fn: string, args: Record<string, any>): Promise<FakeResult<null>> {
    try {
      switch (fn) {
        case "create_game":
          return this.createGame(args);
        case "join_game":
          return this.joinGame(args);
        case "start_game":
          return this.startGame(args);
        case "apply_game_action":
          return this.applyGameAction(args);
        default:
          return { data: null, error: { message: `unknown rpc ${fn}` } };
      }
    } catch (err) {
      return { data: null, error: { message: String(err) } };
    }
  }

  private createGame(args: Record<string, any>): FakeResult<null> {
    if (this.db.games.some((g) => g.room_code === args.p_room_code)) {
      return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
    }
    const now = new Date().toISOString();
    this.db.games.push({
      id: args.p_id,
      room_code: args.p_room_code,
      status: "lobby",
      server_seed_hash: args.p_server_seed_hash,
      roll_index: 0,
      current_player_index: 0,
      turn_phase: "awaiting_roll",
      doubles_count: 0,
      state: args.p_state,
      created_at: now,
      updated_at: now,
    });
    this.db.gameSecrets.push({ game_id: args.p_id, server_seed: args.p_server_seed, deck_state: null });
    return { data: null, error: null };
  }

  private joinGame(args: Record<string, any>): FakeResult<null> {
    if (this.db.playerSecrets.some((s) => s.client_token === args.p_client_token)) {
      return { data: null, error: { code: "23505", message: "duplicate client_token" } };
    }
    this.db.players.push({
      id: args.p_player_id,
      game_id: args.p_game_id,
      name: args.p_name,
      token: args.p_token,
      seat_index: args.p_seat_index,
      cash_cents: args.p_cash_cents,
      position: 0,
      in_jail: false,
      jail_turns: 0,
      jail_free_cards: 0,
      bankrupt: false,
    });
    this.db.playerSecrets.push({ player_id: args.p_player_id, client_token: args.p_client_token });
    const game = this.db.games.find((g) => g.id === args.p_game_id);
    if (!game) return { data: null, error: { message: "game not found" } };
    game.state = args.p_new_state;
    game.updated_at = new Date().toISOString();
    return { data: null, error: null };
  }

  private startGame(args: Record<string, any>): FakeResult<null> {
    const game = this.db.games.find((g) => g.id === args.p_game_id);
    if (!game) return { data: null, error: { message: "game not found" } };
    game.state = args.p_new_state;
    game.status = "active";
    game.turn_phase = "awaiting_roll";
    game.current_player_index = 0;
    game.doubles_count = 0;
    game.updated_at = new Date().toISOString();
    const secrets = this.db.gameSecrets.find((s) => s.game_id === args.p_game_id);
    if (secrets) secrets.deck_state = { owambe: args.p_owambe_deck, village: args.p_village_deck };
    return { data: null, error: null };
  }

  private applyGameAction(args: Record<string, any>): FakeResult<null> {
    const game = this.db.games.find((g) => g.id === args.p_game_id);
    if (!game) return { data: null, error: { message: "game not found" } };
    if (game.roll_index !== args.p_expected_roll_index) {
      return { data: null, error: { code: "P0001", message: "stale game state: roll_index has changed" } };
    }

    game.state = args.p_new_state;
    game.status = args.p_new_status;
    game.roll_index = args.p_new_roll_index;
    game.current_player_index = args.p_new_current_player_index;
    game.turn_phase = args.p_new_turn_phase;
    game.doubles_count = args.p_new_doubles_count;
    game.updated_at = new Date().toISOString();

    for (const update of args.p_player_updates as any[]) {
      const player = this.db.players.find((p) => p.id === update.id && p.game_id === args.p_game_id);
      if (!player) continue;
      player.cash_cents = update.cash_cents;
      player.position = update.position;
      player.in_jail = update.in_jail;
      player.jail_turns = update.jail_turns;
      player.jail_free_cards = update.jail_free_cards;
      player.bankrupt = update.bankrupt;
    }

    if (args.p_roll) {
      this.db.rolls.push({ game_id: args.p_game_id, ...args.p_roll });
    }

    if (args.p_deck_state) {
      const secrets = this.db.gameSecrets.find((s) => s.game_id === args.p_game_id);
      if (secrets) secrets.deck_state = args.p_deck_state;
    }

    let seq = Math.max(0, ...this.db.events.filter((e) => e.game_id === args.p_game_id).map((e) => e.seq), 0);
    for (const event of args.p_events as any[]) {
      seq += 1;
      this.db.events.push({ game_id: args.p_game_id, seq, type: event.type, payload: event.payload });
    }

    return { data: null, error: null };
  }
}
