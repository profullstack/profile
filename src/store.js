/**
 * Storage for the six profile fields, on whatever database the host already has.
 *
 * Two shapes are supported, because the fleet has both:
 *  - a table of its own (default `user_profiles`, keyed by `user_id`), or
 *  - the host's existing table (`profiles` keyed by `id`, or even `users`), to
 *    which `migrate()` adds only the columns that are missing.
 *
 * Like @profullstack/orgs there is no foreign key to a users table: the host's
 * may be named anything or live elsewhere, so the key is a bare value with no
 * constraint, and deleting a user is the host's job (call `remove()`).
 *
 * Drivers: postgres.js (`sql`), node-postgres (Pool/Client), @libsql/client
 * (Turso, SQLite files), and supabase-js on the server. Anything else can pass
 * `{ dialect: "postgres" | "sqlite", query(text, params) => rows }`.
 */
import { COLUMNS } from "./fields.js";

const IDENT = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/i;
const quote = (name) => name.split(".").map((p) => `"${p}"`).join(".");

function checkIdent(name, what) {
  if (!IDENT.test(name)) throw new Error(`profile: invalid ${what} name ${JSON.stringify(name)}`);
  return name;
}

/**
 * Wrap a driver in `{ dialect, query(text, params) -> rows }`; `?` placeholders.
 * `dialect` forces "postgres" or "sqlite" when a client could be either.
 */
export function adapt(db, dialect) {
  if (!db) throw new Error("profile: a database client is required");
  if (db.dialect && typeof db.query === "function") return db;
  if (typeof db.from === "function" && db.auth) return { dialect: "supabase", client: db };
  // postgres.js and Bun's SQL: a tagged-template function with .unsafe().
  if (typeof db === "function" && typeof db.unsafe === "function") {
    return { dialect: "postgres", query: (text, params = []) => db.unsafe(dollars(text), params) };
  }
  // @libsql/client, and @profullstack/libsql-pg, which has the same API but
  // speaks Postgres (protocol "postgres") and translates `?` itself.
  if (typeof db.execute === "function") {
    return {
      dialect: dialect ?? (db.protocol === "postgres" ? "postgres" : "sqlite"),
      query: async (text, params = []) => (await db.execute({ sql: text, args: params })).rows,
    };
  }
  // bun:sqlite and better-sqlite3: synchronous prepared statements. A
  // better-sqlite3 statement that returns no rows must be run(), not all().
  if (typeof db.prepare === "function") {
    return {
      dialect: dialect ?? "sqlite",
      query: async (text, params = []) => {
        const stmt = db.prepare(text);
        try {
          if (stmt.reader === false) {
            stmt.run(...params);
            return [];
          }
          return stmt.all(...params);
        } finally {
          // bun:sqlite keeps the file open (locked on Windows) until every
          // statement is finalized, even after db.close().
          stmt.finalize?.();
        }
      },
    };
  }
  // node-postgres Pool or Client.
  if (typeof db.query === "function") {
    return { dialect: "postgres", query: async (text, params = []) => (await db.query(dollars(text), params)).rows };
  }
  throw new Error("profile: unsupported database client");
}

function dollars(text) {
  let n = 0;
  return text.replace(/\?/g, () => `$${++n}`);
}

/**
 * The DDL for a fresh table, for hosts that keep migrations as files
 * (Supabase, Drizzle). `migrate()` runs the same thing and also upgrades an
 * existing table in place.
 */
export function schemaSql({ dialect = "postgres", table = "user_profiles", key = "user_id", keyType } = {}) {
  checkIdent(table, "table");
  checkIdent(key, "key");
  const pg = dialect !== "sqlite";
  const t = quote(table);
  const idx = table.replace(/\./g, "_");
  const ts = pg ? "timestamptz not null default now()" : "text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))";
  return `create table if not exists ${t} (
  "${key}" ${keyType ?? (pg ? "uuid" : "text")} primary key,
${COLUMNS.map((c) => `  "${c}" text,`).join("\n")}
  "created_at" ${ts},
  "updated_at" ${ts}
);
create index if not exists "${idx}_email" on ${t} (lower("email"));
create index if not exists "${idx}_company_domain" on ${t} ("company_domain");
`;
}

async function existingColumns(db, table) {
  if (db.dialect === "sqlite") {
    const rows = await db.query(`select name from pragma_table_info(?)`, [table.split(".").pop()]);
    return new Set(rows.map((r) => r.name));
  }
  const [schema, name] = table.includes(".") ? table.split(".") : [null, table];
  const rows = await db.query(
    `select column_name from information_schema.columns
     where table_name = ? and table_schema = coalesce(?, current_schema())`,
    [name, schema],
  );
  return new Set(rows.map((r) => r.column_name));
}

/**
 * Create the table, or add whatever columns an existing one lacks. Safe to run
 * on every boot and from two instances at once. There is no advisory lock:
 * through a pool the lock and unlock can land on different connections and
 * leave the lock held. Every statement is idempotent instead, and the one race
 * left (two creators at once) is settled by retrying on "already exists".
 */
export async function migrate(dbOrStore, opts = {}) {
  const store = dbOrStore?.__profileStore ? dbOrStore : createProfileStore(dbOrStore, opts);
  const { db, table, key, keyType } = store;
  if (db.dialect === "supabase") {
    throw new Error(
      "profile: supabase-js cannot run DDL. Add schemaSql() to a migration file instead:\n\n" +
        schemaSql({ table, key, keyType }),
    );
  }
  for (let attempt = 0; ; attempt++) {
    try {
      return await migrateOnce(db, { table, key, keyType });
    } catch (e) {
      if (attempt < 3 && isAlreadyExists(e)) continue;
      throw e;
    }
  }
}

// Postgres: duplicate_table, duplicate_object, duplicate_column, and the
// unique_violation on pg_type that two concurrent CREATE TABLEs can raise.
// SQLite: "already exists" / "duplicate column name".
function isAlreadyExists(e) {
  const code = e?.code ?? e?.cause?.code;
  if (["42P07", "42710", "42701", "23505"].includes(code)) return true;
  return /already exists|duplicate column/i.test(String(e?.message ?? ""));
}

async function migrateOnce(db, { table, key, keyType }) {
  const pg = db.dialect === "postgres";
  const have = await existingColumns(db, table);
  if (have.size === 0) {
    for (const stmt of schemaSql({ dialect: db.dialect, table, key, keyType }).split(";\n")) {
      if (stmt.trim()) await db.query(stmt);
    }
    return { created: true, added: [] };
  }
  if (!have.has(key)) throw new Error(`profile: table ${table} has no key column ${key}`);
  const added = [];
  for (const col of [...COLUMNS, "created_at", "updated_at"]) {
    if (have.has(col)) continue;
    // SQLite cannot add a column whose default is not a constant, so the
    // timestamps arrive empty and are filled on the next write.
    const type = col.endsWith("_at") ? (pg ? "timestamptz default now()" : "text") : "text";
    try {
      await db.query(`alter table ${quote(table)} add column ${pg ? "if not exists " : ""}"${col}" ${type}`);
      added.push(col);
    } catch (e) {
      if (!isAlreadyExists(e)) throw e;
    }
  }
  if (added.includes("email")) {
    const idx = table.replace(/\./g, "_");
    await db.query(`create index if not exists "${idx}_email" on ${quote(table)} (lower("email"))`);
  }
  return { created: false, added };
}

/** Only the contract's fields, from whatever object was passed. */
function pick(profile) {
  const out = {};
  for (const c of COLUMNS) if (profile && c in profile && profile[c] !== undefined) out[c] = profile[c] ?? null;
  return out;
}

function toProfile(row, key) {
  if (!row) return null;
  const out = { user_id: row[key] == null ? null : String(row[key]) };
  for (const c of COLUMNS) out[c] = row[c] ?? null;
  for (const c of ["created_at", "updated_at"]) {
    const v = row[c];
    out[c] = v == null ? null : v instanceof Date ? v.toISOString() : String(v);
  }
  return out;
}

/**
 * Create a store. Options: `table` (default "user_profiles"), `key` (default
 * "user_id"; "id" for a Supabase-style `profiles` table), `keyType` (DDL only;
 * default uuid on Postgres, text on SQLite), `dialect` (force "postgres" or
 * "sqlite" for a client that could be either).
 */
export function createProfileStore(dbClient, { table = "user_profiles", key = "user_id", keyType, dialect } = {}) {
  checkIdent(table, "table");
  checkIdent(key, "key");
  const db = adapt(dbClient, dialect);
  if (db.dialect === "supabase") return supabaseStore(db.client, { table, key, keyType, db });

  const t = quote(table);
  const k = `"${key}"`;
  const now = () => new Date().toISOString();
  const cols = [key, ...COLUMNS, "created_at", "updated_at"].map((c) => `"${c}"`).join(", ");

  async function write(userId, profile, mode) {
    if (userId == null || userId === "") throw new Error("profile: a user id is required");
    const fields = pick(profile);
    const names = Object.keys(fields);
    const stamp = now();
    const insertCols = [k, ...names.map((n) => `"${n}"`), `"created_at"`, `"updated_at"`];
    const values = [String(userId), ...names.map((n) => fields[n]), stamp, stamp];
    const placeholders = insertCols.map(() => "?");
    const set = names.map((n) =>
      mode === "fill" ? `"${n}" = coalesce(p."${n}", excluded."${n}")` : `"${n}" = excluded."${n}"`,
    );
    set.push(`"updated_at" = excluded."updated_at"`);
    const rows = await db.query(
      `insert into ${t} as p (${insertCols.join(", ")}) values (${placeholders.join(", ")})
       on conflict (${k}) do update set ${set.join(", ")}
       returning ${cols}`,
      values,
    );
    return toProfile(rows[0], key);
  }

  const self = {
    __profileStore: true,
    db,
    table,
    key,
    keyType,
    migrate: () => migrate(self),

    async get(userId) {
      const rows = await db.query(`select ${cols} from ${t} where ${k} = ?`, [String(userId)]);
      return toProfile(rows[0], key);
    },

    async getByEmail(email) {
      const rows = await db.query(`select ${cols} from ${t} where lower("email") = lower(?) limit 1`, [
        String(email),
      ]);
      return toProfile(rows[0], key);
    },

    /** Write the fields present in `profile`; absent ones are left alone, null clears. */
    save: (userId, profile) => write(userId, profile, "set"),

    /** Write only into fields that are empty. For backfills and enrichment. */
    fillBlanks: (userId, profile) => write(userId, profile, "fill"),

    async remove(userId) {
      await db.query(`delete from ${t} where ${k} = ?`, [String(userId)]);
    },

    /**
     * A page of profiles in key order. `after` is the previous page's `next`;
     * `since` limits to rows updated at or after an ISO time.
     */
    async list({ limit = 500, after = null, since = null } = {}) {
      const where = [];
      const params = [];
      if (after != null) (where.push(`${k} > ?`), params.push(String(after)));
      if (since) (where.push(`"updated_at" >= ?`), params.push(since));
      params.push(Math.min(Math.max(1, Number(limit) || 500), 5000));
      const rows = await db.query(
        `select ${cols} from ${t} ${where.length ? `where ${where.join(" and ")}` : ""}
         order by ${k} limit ?`,
        params,
      );
      const profiles = rows.map((r) => toProfile(r, key));
      return { profiles, next: profiles.length === params.at(-1) ? profiles.at(-1).user_id : null };
    },

    async *all(opts = {}) {
      let after = null;
      do {
        const page = await self.list({ ...opts, after });
        yield* page.profiles;
        after = page.next;
      } while (after != null);
    },
  };
  return self;
}

function supabaseStore(client, { table, key, keyType, db }) {
  const sel = [key, ...COLUMNS, "created_at", "updated_at"].join(",");
  const from = () => client.from(table);
  const must = ({ data, error }) => {
    if (error) throw new Error(`profile: ${error.message}`);
    return data;
  };
  const self = {
    __profileStore: true,
    db,
    table,
    key,
    keyType,
    migrate: () => migrate(self),
    async get(userId) {
      return toProfile(must(await from().select(sel).eq(key, String(userId)).maybeSingle()), key);
    },
    async getByEmail(email) {
      return toProfile(must(await from().select(sel).ilike("email", String(email)).limit(1).maybeSingle()), key);
    },
    async save(userId, profile) {
      const row = { [key]: String(userId), ...pick(profile), updated_at: new Date().toISOString() };
      return toProfile(must(await from().upsert(row, { onConflict: key }).select(sel).single()), key);
    },
    async fillBlanks(userId, profile) {
      const current = (await self.get(userId)) ?? {};
      const fields = pick(profile);
      for (const c of Object.keys(fields)) if (current[c]) delete fields[c];
      return self.save(userId, fields);
    },
    async remove(userId) {
      must(await from().delete().eq(key, String(userId)));
    },
    async list({ limit = 500, after = null, since = null } = {}) {
      const n = Math.min(Math.max(1, Number(limit) || 500), 5000);
      let q = from().select(sel).order(key).limit(n);
      if (after != null) q = q.gt(key, String(after));
      if (since) q = q.gte("updated_at", since);
      const profiles = must(await q).map((r) => toProfile(r, key));
      return { profiles, next: profiles.length === n ? profiles.at(-1).user_id : null };
    },
    async *all(opts = {}) {
      let after = null;
      do {
        const page = await self.list({ ...opts, after });
        yield* page.profiles;
        after = page.next;
      } while (after != null);
    },
  };
  return self;
}
