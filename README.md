# @profullstack/profile

One user profile for every Profullstack property. Six fields, in this order, everywhere:

| column | what it holds | example |
| --- | --- | --- |
| `email` | the contact address, lower-cased | `ada@acme.com` |
| `first_name` | as typed, case kept | `Ada` |
| `last_name` | as typed, case kept | `Lovelace` |
| `company_domain` | bare domain, no scheme or `www.` | `acme.com` |
| `job_title` | as typed, whitespace cleaned | `VP Engineering` |
| `linkedin_url` | canonical profile URL | `https://www.linkedin.com/in/ada-lovelace` |

The order is the CSV column order Explee, Apollo and cli-tools `user-export --full` read, so an export from any property imports anywhere without remapping.

What the package gives a property:

- **Validation and normalization.** `acme.com/about`, `https://www.Acme.com` and `@acme.com` all become `acme.com`. Any LinkedIn URL, `in/x` or bare handle becomes the canonical URL. A link in a name box is refused as spam. Names are never "corrected" (McDonald stays McDonald).
- **Company from a work email.** A blank company domain is filled from the signup email unless it is a personal or relay mailbox (gmail, proton, passmail and so on).
- **Signup form fields.** As an HTML string for server-rendered pages, and as a React component, with the right `autocomplete` tokens so browsers fill them.
- **Storage on whatever the property already runs:** postgres.js, Bun SQL, node-postgres, libSQL/Turso, @profullstack/libsql-pg, bun:sqlite, better-sqlite3, or supabase-js on the server. Either its own `user_profiles` table, or the columns added to an existing `profiles`/`users` table.
- **`GET`/`PUT`/`PATCH /api/v1/me/profile`** handlers on Web-standard Request/Response, for Next and Hono alike.
- **A CLI and an MCP server** (`profile`), including `profile export` in contract order.

```sh
npm i @profullstack/profile
```

It has no dependencies. `postgres`, `@libsql/client` and `react` are optional peers; the property already has whichever it uses.

## Required fields

By default a signup must give `email`, `first_name` and `last_name`; the other three are offered and marked optional, because every required box costs signups. A property that sells to companies passes `LEAD_REQUIRED` (adds `company_domain` and `job_title`, the fields an outbound tool will not import a lead without).

```js
import { validateProfile, LEAD_REQUIRED } from "@profullstack/profile";
validateProfile(form, { required: LEAD_REQUIRED });
```

## Adopting it in a property

1. **Schema.** Call `migrate()` on boot or in the migration runner. It creates `user_profiles`, or adds only the missing columns to the table you name. Postgres takes an advisory lock, so concurrent boots are safe. On Supabase (no DDL through supabase-js), put `profile schema` output in a migration file.
2. **Signup form.** Add the fields beside the email box.
3. **Signup handler.** Validate before creating the user, save after.
4. **Profile page.** Mount the handlers and let people fill in what they skipped.
5. **Backfill.** Copy any name or company columns the property already has, using `fillBlanks` so nothing typed is overwritten.

### Next on Postgres (postgres.js)

```js
// lib/profile.js
import sql from "@/lib/db";
import { createProfileStore } from "@profullstack/profile";
export const profiles = createProfileStore(sql); // or { table: "profiles", key: "id" }
```

```jsx
// app/signup/page.jsx (a server component posting to a route handler or a server action)
import { ProfileFields } from "@profullstack/profile/react";

<form action={signup}>
  <ProfileFields />
  <button>Send me a sign-in link</button>
</form>
```

```js
// the signup action / POST handler
import { validateProfile, saveSignupProfile } from "@profullstack/profile";

const check = validateProfile(formData);
if (!check.ok) return { errors: check.errors };
const user = await createUserAndSendMagicLink(check.profile.email);
await saveSignupProfile(profiles, user.id, formData, { email: user.email });
```

```js
// app/api/v1/me/profile/route.js
import { createProfileHandlers } from "@profullstack/profile";
import { profiles } from "@/lib/profile";
import { currentUser } from "@/lib/session";

export const { GET, PUT, PATCH } = createProfileHandlers({
  store: profiles,
  getUser: (req) => currentUser(req), // { id, email } or null
});
```

### Hono on Turso

```js
import { createClient } from "@libsql/client";
import { createProfileStore, mountProfileRoutes, renderProfileFields, PROFILE_ENHANCE_SCRIPT } from "@profullstack/profile";

const profiles = createProfileStore(createClient({ url, authToken }));
await profiles.migrate();
mountProfileRoutes(app, { store: profiles, getUser: (req) => sessionUser(req) });

app.get("/signup", (c) =>
  c.html(`<form method="post" action="/signup">
    ${renderProfileFields()}
    <button>Sign up</button>
  </form><script>${PROFILE_ENHANCE_SCRIPT}</script>`),
);
```

### Supabase

Browsers talk only to `/api`, so the store runs on the server with the service client:

```js
const profiles = createProfileStore(supabaseAdmin, { table: "profiles", key: "id" });
```

```sh
npx @profullstack/profile schema --table profiles --key id > supabase/migrations/20261026000000_profile_fields.sql
```

(For an existing table, write the `alter table ... add column if not exists` lines yourself, or run `profile migrate` with `DATABASE_URL` pointing at the database.)

## Store API

```js
const profiles = createProfileStore(db, { table = "user_profiles", key = "user_id" });
await profiles.migrate();                        // { created, added: [columns] }
await profiles.save(userId, { job_title: "CTO" }); // only given fields; null clears
await profiles.fillBlanks(userId, enriched);      // never overwrites what a person typed
await profiles.get(userId);  await profiles.getByEmail(email);
await profiles.list({ limit, after, since });     // keyset pages: { profiles, next }
for await (const p of profiles.all()) { ... }
await profiles.remove(userId);
```

A hand-written adapter is `{ dialect: "postgres" | "sqlite", query(text, params) }` and receives `?` placeholders. A Postgres client wrapped to look like `@libsql/client` (anything with `execute()` that is not `@profullstack/libsql-pg`) is taken for SQLite: pass `dialect: "postgres"`.

There is no foreign key to a users table: the host's may be named anything or live elsewhere. Deleting a user is the host's job, so call `remove()` there.

## CLI and MCP

```sh
export DATABASE_URL=postgres://...      # or libsql://..., file:app.db (TURSO_AUTH_TOKEN for Turso)
profile migrate
profile get <user-id>
profile find ada@acme.com
profile set <user-id> --job-title CTO --linkedin in/ada-lovelace
profile check --company-domain https://www.acme.com/about
profile export --complete > leads.csv     # only rows with every lead field
profile export --format tsv --since 2026-10-01
profile mcp                               # tools: get_profile, update_profile, validate_profile, export_profiles
```

`--table` and `--key` (or `PROFILE_TABLE`, `PROFILE_KEY`) point it at an existing table.

## License

MIT
