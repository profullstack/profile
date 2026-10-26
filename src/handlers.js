/**
 * HTTP for the profile, on Web-standard Request/Response so the same handlers
 * are a Next route (`export const { GET, PUT, PATCH } = createProfileHandlers(...)`)
 * and a Hono route (`mountProfileRoutes(app, ...)`), with no dependency on either.
 */
import { DEFAULT_REQUIRED } from "./fields.js";
import { validateProfile, missingFields } from "./validate.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

async function readBody(request) {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) return request.json();
  if (type.includes("form")) return request.formData();
  const text = await request.text();
  return text ? JSON.parse(text) : {};
}

/**
 * Validate a signup's profile fields and store them for a user who was just
 * created. The signup handler calls this right after it has a user id:
 *
 *   const result = await saveSignupProfile(store, user.id, form, { email: user.email });
 *   if (!result.ok) return badRequest(result.errors);
 *
 * Validate before creating the user (validateProfile) when a failure should
 * stop the signup; this call validates again and is safe to repeat.
 */
export async function saveSignupProfile(store, userId, input, { email, required = DEFAULT_REQUIRED } = {}) {
  const result = validateProfile(withEmail(input, email), { required });
  if (!result.ok) return result;
  return { ...result, profile: await store.save(userId, result.profile) };
}

function withEmail(input, email) {
  if (!email) return input;
  const has = input && (typeof input.get === "function" ? input.get("email") : input.email);
  if (has) return input;
  if (typeof input?.entries === "function" && input.constructor !== Object) {
    return { ...Object.fromEntries(input.entries()), email };
  }
  return { ...(input ?? {}), email };
}

/**
 * `getUser(request)` returns `{ id, email? }` for the signed-in user, or null.
 * The account email fills the profile email when the profile has none.
 * `required` applies to PUT (a whole profile); PATCH checks only what it sends.
 */
export function createProfileHandlers({ store, getUser, required = DEFAULT_REQUIRED, onSaved } = {}) {
  if (!store || typeof getUser !== "function") throw new Error("profile: store and getUser are required");

  const authed = (fn) => async (request, ...rest) => {
    let user;
    try {
      user = await getUser(request, ...rest);
    } catch {
      user = null;
    }
    if (!user?.id) return json({ error: "Sign in first." }, 401);
    try {
      return await fn(request, user);
    } catch (e) {
      if (e instanceof SyntaxError) return json({ error: "The body is not valid JSON." }, 400);
      throw e;
    }
  };

  const write = (partial) =>
    authed(async (request, user) => {
      const body = await readBody(request);
      const input = partial ? body : withEmail(body, user.email);
      const result = validateProfile(input, { required, partial });
      if (!result.ok) return json({ error: "Some fields need fixing.", errors: result.errors }, 400);
      const profile = await store.save(user.id, result.profile);
      await onSaved?.(profile, user);
      return json({ profile, missing: missingFields(profile, required) });
    });

  return {
    GET: authed(async (_request, user) => {
      const profile = (await store.get(user.id)) ?? { user_id: String(user.id), email: user.email ?? null };
      if (!profile.email && user.email) profile.email = user.email;
      return json({ profile, missing: missingFields(profile, required) });
    }),
    PUT: write(false),
    PATCH: write(true),
  };
}

/** Mount on a Hono app (or anything with get/put/patch(path, c => Response)). */
export function mountProfileRoutes(app, { path = "/api/v1/me/profile", ...opts } = {}) {
  const h = createProfileHandlers(opts);
  app.get(path, (c) => h.GET(c.req.raw, c));
  app.put(path, (c) => h.PUT(c.req.raw, c));
  app.patch(path, (c) => h.PATCH(c.req.raw, c));
  return app;
}
