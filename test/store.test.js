import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";
import postgres from "postgres";
import { createProfileStore, migrate, createProfileHandlers, saveSignupProfile } from "../src/index.js";

// Every behaviour is checked on both dialects. Postgres runs when
// TEST_DATABASE_URL is set (CI starts one); libSQL always runs in memory.
const backends = [
  ["libsql", async () => {
    const client = createClient({ url: ":memory:" });
    return { db: client, exec: (q) => client.execute(q), close: () => client.close() };
  }],
  // node:sqlite has the synchronous prepare() API of bun:sqlite and better-sqlite3.
  ["node:sqlite", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(":memory:");
    return { db, exec: (q) => db.exec(q), close: () => db.close() };
  }],
];
if (process.env.TEST_DATABASE_URL) {
  const fresh = async (sql) => sql.unsafe("drop table if exists user_profiles, profiles cascade");
  backends.push(["postgres", async () => {
    const sql = postgres(process.env.TEST_DATABASE_URL, { onnotice: () => {}, max: 4 });
    await fresh(sql);
    return { db: sql, exec: (q) => sql.unsafe(q), close: () => sql.end() };
  }]);
  // @profullstack/libsql-pg looks like @libsql/client but speaks Postgres.
  backends.push(["libsql-pg", async () => {
    const { createClient: pgClient } = await import("@profullstack/libsql-pg");
    const sql = postgres(process.env.TEST_DATABASE_URL, { onnotice: () => {}, max: 1 });
    await fresh(sql);
    await sql.end();
    const client = pgClient({ url: process.env.TEST_DATABASE_URL });
    return { db: client, exec: (q) => client.execute(q), close: () => client.close() };
  }]);
}

const uid = () => crypto.randomUUID();

for (const [name, open] of backends) {
  describe(`store on ${name}`, () => {
    let conn;
    let store;
    before(async () => {
      conn = await open();
      store = createProfileStore(conn.db);
      assert.deepEqual(await migrate(store), { created: true, added: [] });
    });
    after(() => conn.close());

    test("migrate is idempotent, and concurrent runs do not collide", async () => {
      const results = await Promise.all([migrate(store), migrate(store)]);
      for (const r of results) assert.deepEqual(r, { created: false, added: [] });
    });

    test("save, then get", async () => {
      const id = uid();
      const saved = await store.save(id, { email: "ada@acme.com", first_name: "Ada", last_name: "Lovelace" });
      assert.equal(saved.user_id, id);
      assert.equal(saved.first_name, "Ada");
      assert.equal(saved.job_title, null);
      assert.ok(saved.updated_at);
      const got = await store.get(id);
      assert.equal(got.email, "ada@acme.com");
      assert.equal(await store.get(uid()), null);
    });

    test("save leaves absent fields alone and clears explicit nulls", async () => {
      const id = uid();
      await store.save(id, { email: "b@acme.com", first_name: "B", job_title: "CTO" });
      const p = await store.save(id, { last_name: "Babbage", job_title: null });
      assert.equal(p.first_name, "B");
      assert.equal(p.last_name, "Babbage");
      assert.equal(p.job_title, null);
    });

    test("fillBlanks never overwrites what a person typed", async () => {
      const id = uid();
      await store.save(id, { email: "c@acme.com", job_title: "Founder" });
      const p = await store.fillBlanks(id, { job_title: "Enriched Title", company_domain: "acme.com" });
      assert.equal(p.job_title, "Founder");
      assert.equal(p.company_domain, "acme.com");
    });

    test("getByEmail ignores case", async () => {
      const id = uid();
      await store.save(id, { email: "dee@acme.com" });
      assert.equal((await store.getByEmail("DEE@Acme.com")).user_id, id);
    });

    test("list pages in key order and all() walks every page", async () => {
      const ids = Array.from({ length: 7 }, uid);
      for (const id of ids) await store.save(id, { email: `${id.slice(0, 6)}@x.io` });
      const first = await store.list({ limit: 3 });
      assert.equal(first.profiles.length, 3);
      assert.ok(first.next);
      const second = await store.list({ limit: 3, after: first.next });
      assert.ok(second.profiles[0].user_id > first.profiles[2].user_id);
      const seen = [];
      for await (const p of store.all({ limit: 3 })) seen.push(p.user_id);
      for (const id of ids) assert.ok(seen.includes(id));
      assert.equal(new Set(seen).size, seen.length);
    });

    test("remove", async () => {
      const id = uid();
      await store.save(id, { email: "gone@x.io" });
      await store.remove(id);
      assert.equal(await store.get(id), null);
    });

    test("an existing profiles table gets only the missing columns", async () => {
      await conn.exec(`create table profiles (id text primary key, first_name text, avatar_url text)`);
      const s = createProfileStore(conn.db, { table: "profiles", key: "id" });
      const r = await migrate(s);
      assert.equal(r.created, false);
      assert.deepEqual(r.added.sort(), [
        "company_domain", "created_at", "email", "job_title", "last_name", "linkedin_url", "updated_at",
      ]);
      const p = await s.save("u1", { first_name: "Ada", linkedin_url: "https://www.linkedin.com/in/ada" });
      assert.equal(p.user_id, "u1");
      assert.equal(p.linkedin_url, "https://www.linkedin.com/in/ada");
    });

    test("saveSignupProfile validates, derives the company and stores", async () => {
      const id = uid();
      const bad = await saveSignupProfile(store, id, { first_name: "A" }, { email: "a@acme.com" });
      assert.equal(bad.ok, false);
      assert.ok(bad.errors.last_name);
      assert.equal(await store.get(id), null);
      const good = await saveSignupProfile(store, id, { first_name: "A", last_name: "B" }, { email: "a@acme.com" });
      assert.equal(good.ok, true);
      assert.equal(good.profile.company_domain, "acme.com");
      assert.equal((await store.get(id)).email, "a@acme.com");
    });

    test("HTTP handlers: 401, GET defaults, PATCH partial, PUT full", async () => {
      const id = uid();
      let user = null;
      const h = createProfileHandlers({ store, getUser: () => user });
      const req = (method, body) =>
        new Request("http://x/api/v1/me/profile", {
          method,
          headers: { "content-type": "application/json" },
          body: body && JSON.stringify(body),
        });
      assert.equal((await h.GET(req("GET"))).status, 401);
      user = { id, email: "eve@acme.com" };
      let res = await (await h.GET(req("GET"))).json();
      assert.equal(res.profile.email, "eve@acme.com");
      assert.deepEqual(res.missing, ["first_name", "last_name"]);
      res = await h.PATCH(req("PATCH", { linkedin_url: "nope.com/x" }));
      assert.equal(res.status, 400);
      assert.ok((await res.json()).errors.linkedin_url);
      res = await (await h.PATCH(req("PATCH", { job_title: "CEO" }))).json();
      assert.equal(res.profile.job_title, "CEO");
      assert.equal(res.profile.email, "eve@acme.com", "PATCH fills a missing email from the account");
      res = await h.PUT(req("PUT", { first_name: "Eve" }));
      assert.equal(res.status, 400, "PUT needs the required fields");
      res = await (await h.PUT(req("PUT", { first_name: "Eve", last_name: "Ng" }))).json();
      assert.equal(res.profile.email, "eve@acme.com");
      assert.equal(res.profile.company_domain, "acme.com");
      assert.deepEqual(res.missing, []);
      const bad = await h.PATCH(
        new Request("http://x", { method: "PATCH", headers: { "content-type": "application/json" }, body: "{" }),
      );
      assert.equal(bad.status, 400);
    });
  });
}
