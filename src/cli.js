#!/usr/bin/env node
/**
 * profile - the six signup fields of any property, from a terminal or an agent.
 *
 * Reads PROFILE_DATABASE_URL or DATABASE_URL: postgres:// uses postgres.js,
 * libsql://, file: and *.db use @libsql/client. Whichever the property uses is
 * already installed there; this package depends on neither.
 */
import { createWriteStream } from "node:fs";
import { createInterface } from "node:readline";
import {
  COLUMNS,
  LEAD_REQUIRED,
  createProfileStore,
  migrate,
  schemaSql,
  validateProfile,
  missingFields,
  csvHeader,
  csvRow,
} from "./index.js";

const VERSION = "0.1.5";

const USAGE = `profile - signup profile fields (${COLUMNS.join(", ")})

  profile migrate                        create the table, or add missing columns
  profile schema [--dialect sqlite] [--key-type text]
                                         print the DDL for a migration file
  profile get <user-id>                  one profile
  profile find <email>                   look a profile up by email
  profile set <user-id> --first-name Ada --company-domain acme.com ...
                                         validate and save the given fields
  profile check --email a@acme.com --linkedin linkedin.com/in/ada
                                         validate and normalize, no database
  profile export [--format csv|tsv|json|jsonl] [--complete] [--since ISO] [--out FILE]
                                         every profile, columns in contract order;
                                         --complete keeps only lead-ready rows
  profile mcp                            MCP server on stdio

Options: --table user_profiles  --key user_id   (or PROFILE_TABLE, PROFILE_KEY)
Environment: PROFILE_DATABASE_URL or DATABASE_URL`;

function parseArgs(argv) {
  const flags = {};
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      args.push(a);
      continue;
    }
    const [k, inline] = a.slice(2).split(/=(.*)/s);
    const key = k.replace(/-/g, "_");
    if (inline !== undefined) flags[key] = inline;
    else if (argv[i + 1] === undefined || argv[i + 1].startsWith("--")) flags[key] = true;
    else flags[key] = argv[++i];
  }
  return { flags, args };
}

/** Flags named like the fields (or their aliases) become a profile input. */
function fieldFlags(flags) {
  const skip = new Set(["table", "key", "key_type", "format", "out", "since", "complete", "dialect", "help", "json"]);
  return Object.fromEntries(Object.entries(flags).filter(([k]) => !skip.has(k)));
}

async function connect(flags) {
  const url = process.env.PROFILE_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("PROFILE_DATABASE_URL or DATABASE_URL is not set");
    process.exit(2);
  }
  const opts = {
    table: flags.table || process.env.PROFILE_TABLE || undefined,
    key: flags.key || process.env.PROFILE_KEY || undefined,
  };
  if (/^postgres(ql)?:/.test(url)) {
    const { default: postgres } = await import("postgres");
    const sql = postgres(url, { onnotice: () => {}, max: 2 });
    return { store: createProfileStore(sql, opts), close: () => sql.end() };
  }
  const { createClient } = await import("@libsql/client");
  const client = createClient({
    url: /^(libsql|https?|wss?|file):/.test(url) ? url : `file:${url}`,
    authToken: process.env.PROFILE_DATABASE_TOKEN || process.env.TURSO_AUTH_TOKEN || undefined,
  });
  return { store: createProfileStore(client, opts), close: () => client.close() };
}

const print = (v) => console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2));

async function exportProfiles(store, { format = "csv", complete = false, since, out } = {}) {
  const stream = out ? createWriteStream(out) : process.stdout;
  const write = (s) => new Promise((r) => (stream.write(s) ? r() : stream.once("drain", r)));
  const delimiter = format === "tsv" ? "\t" : ",";
  let n = 0;
  if (format === "csv" || format === "tsv") await write(csvHeader({ delimiter }) + "\n");
  if (format === "json") await write("[");
  for await (const p of store.all({ since })) {
    if (complete && missingFields(p, LEAD_REQUIRED).length) continue;
    if (format === "json") await write((n ? ",\n" : "\n") + JSON.stringify(p));
    else if (format === "jsonl") await write(JSON.stringify(p) + "\n");
    else await write(csvRow(p, { delimiter }) + "\n");
    n++;
  }
  if (format === "json") await write("\n]\n");
  if (out) await new Promise((r) => stream.end(r));
  return n;
}

// ---------------------------------------------------------------- MCP (stdio)

const TOOLS = [
  {
    name: "get_profile",
    description: "Read one user's profile (email, name, company domain, job title, LinkedIn) by user id or email.",
    inputSchema: {
      type: "object",
      properties: { user_id: { type: "string" }, email: { type: "string" } },
    },
  },
  {
    name: "update_profile",
    description:
      "Validate and save profile fields for a user. Only the fields given are changed; an empty string clears one. company_domain accepts a URL or email; linkedin_url accepts a handle or any LinkedIn profile URL.",
    inputSchema: {
      type: "object",
      required: ["user_id"],
      properties: {
        user_id: { type: "string" },
        ...Object.fromEntries(COLUMNS.map((c) => [c, { type: "string" }])),
        only_blanks: { type: "boolean", description: "Write only into fields that are empty (enrichment)." },
      },
    },
  },
  {
    name: "validate_profile",
    description: "Normalize and validate profile fields without saving. Returns the canonical values and any errors.",
    inputSchema: { type: "object", properties: Object.fromEntries(COLUMNS.map((c) => [c, { type: "string" }])) },
  },
  {
    name: "export_profiles",
    description: `Export profiles as CSV with columns ${COLUMNS.join(",")}. complete=true keeps only rows with every lead field.`,
    inputSchema: {
      type: "object",
      properties: {
        complete: { type: "boolean" },
        since: { type: "string", description: "ISO time; only rows updated since." },
        limit: { type: "number", description: "Default 1000." },
      },
    },
  },
];

async function callTool(getStore, name, a = {}) {
  if (name === "validate_profile") return validateProfile(a, { required: [] });
  const store = await getStore();
  if (name === "get_profile") {
    const p = a.user_id ? await store.get(a.user_id) : a.email ? await store.getByEmail(a.email) : null;
    if (!a.user_id && !a.email) throw new Error("give user_id or email");
    return p ?? { error: "not found" };
  }
  if (name === "update_profile") {
    const { user_id, only_blanks, ...fields } = a;
    const r = validateProfile(fields, { required: [], partial: true });
    if (!r.ok) return { error: "invalid", errors: r.errors };
    return only_blanks ? store.fillBlanks(user_id, r.profile) : store.save(user_id, r.profile);
  }
  if (name === "export_profiles") {
    const limit = Math.min(Number(a.limit) || 1000, 20000);
    const rows = [csvHeader()];
    for await (const p of store.all({ since: a.since })) {
      if (a.complete && missingFields(p, LEAD_REQUIRED).length) continue;
      rows.push(csvRow(p));
      if (rows.length > limit) break;
    }
    return rows.join("\n");
  }
  throw new Error(`unknown tool ${name}`);
}

async function serveMcp(flags) {
  let conn;
  const getStore = async () => (conn ??= await connect(flags)).store;
  const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      continue;
    }
    const { id, method, params } = msg;
    if (id === undefined) continue; // notifications need no answer
    const reply = (result) => send({ jsonrpc: "2.0", id, result });
    try {
      if (method === "initialize") {
        reply({
          protocolVersion: params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "@profullstack/profile", version: VERSION },
        });
      } else if (method === "ping") reply({});
      else if (method === "tools/list") reply({ tools: TOOLS });
      else if (method === "tools/call") {
        try {
          const out = await callTool(getStore, params?.name, params?.arguments);
          reply({ content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out, null, 2) }] });
        } catch (e) {
          reply({ content: [{ type: "text", text: String(e.message ?? e) }], isError: true });
        }
      } else send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
    } catch (e) {
      send({ jsonrpc: "2.0", id, error: { code: -32603, message: String(e.message ?? e) } });
    }
  }
  await conn?.close();
}

// ---------------------------------------------------------------- main

const { flags, args } = parseArgs(process.argv.slice(2));
const [cmd, ...rest] = args;

if (flags.version) {
  print(VERSION);
  process.exit(0);
}
if (!cmd || flags.help || cmd === "help") {
  print(USAGE);
  process.exit(0);
}

if (cmd === "mcp") {
  await serveMcp(flags);
  process.exit(0);
}
if (cmd === "schema") {
  print(
    schemaSql({
      dialect: flags.dialect === "sqlite" ? "sqlite" : "postgres",
      table: flags.table,
      key: flags.key,
      keyType: flags.key_type,
    }),
  );
  process.exit(0);
}
if (cmd === "check") {
  const r = validateProfile(fieldFlags(flags), { required: [] });
  print(r);
  process.exit(r.ok ? 0 : 1);
}

const { store, close } = await connect(flags);
let code = 0;
try {
  if (cmd === "migrate") print(await migrate(store));
  else if (cmd === "get") print((await store.get(rest[0])) ?? "not found");
  else if (cmd === "find") print((await store.getByEmail(rest[0])) ?? "not found");
  else if (cmd === "set") {
    if (!rest[0]) throw new Error("profile set <user-id> --field value ...");
    const r = validateProfile(fieldFlags(flags), { required: [], partial: true });
    if (!r.ok) {
      print(r.errors);
      code = 1;
    } else print(await store.save(rest[0], r.profile));
  } else if (cmd === "export") {
    const n = await exportProfiles(store, flags);
    console.error(`${n} profile(s)`);
  } else {
    console.error(`unknown command: ${cmd}\n\n${USAGE}`);
    code = 2;
  }
} catch (e) {
  console.error(e.message ?? e);
  code = 1;
} finally {
  await close();
}
process.exit(code);
