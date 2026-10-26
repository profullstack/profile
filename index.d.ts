export type ProfileField =
  | "email"
  | "first_name"
  | "last_name"
  | "company_domain"
  | "job_title"
  | "linkedin_url";

export type ProfileFields = { [K in ProfileField]: string | null };

export interface Profile extends ProfileFields {
  user_id: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface FieldMeta {
  name: ProfileField;
  label: string;
  type: "email" | "text" | "url";
  autocomplete: string;
  inputmode?: string;
  maxLength: number;
  placeholder?: string;
  hint?: string;
}

export const COLUMNS: readonly ProfileField[];
export const FIELDS: readonly FieldMeta[];
export const FIELD_BY_NAME: Readonly<Record<ProfileField, FieldMeta>>;
export const DEFAULT_REQUIRED: readonly ProfileField[];
export const LEAD_REQUIRED: readonly ProfileField[];

export class ProfileFieldError extends Error {
  field: ProfileField;
}
export class ProfileValidationError extends Error {
  status: 400;
  errors: Partial<Record<ProfileField, string>>;
}

export const NORMALIZERS: Readonly<Record<ProfileField, (v: unknown) => string | null>>;
export const FREEMAIL: Set<string>;
export function isFreemail(domain: string | null | undefined): boolean;
export function cleanText(v: unknown): string;
export function normalizeEmail(v: unknown): string | null;
export function normalizeFirstName(v: unknown): string | null;
export function normalizeLastName(v: unknown): string | null;
export function normalizeDomain(v: unknown): string | null;
export function normalizeJobTitle(v: unknown): string | null;
export function normalizeLinkedin(v: unknown): string | null;
export function domainFromEmail(email: string | null | undefined): string | null;
export function splitFullName(full: string | null | undefined): {
  first_name: string | null;
  last_name: string | null;
};

export type ProfileInput =
  | FormData
  | URLSearchParams
  | Map<string, unknown>
  | Record<string, unknown>
  | null
  | undefined;

export interface ValidateOptions {
  required?: readonly ProfileField[];
  partial?: boolean;
  deriveDomain?: boolean;
}
export interface ValidationResult {
  ok: boolean;
  profile: Partial<ProfileFields>;
  errors: Partial<Record<ProfileField, string>>;
}
export function readProfileInput(input: ProfileInput): Partial<Record<ProfileField, string | null>>;
export function validateProfile(input: ProfileInput, options?: ValidateOptions): ValidationResult;
export function parseProfile(input: ProfileInput, options?: ValidateOptions): Partial<ProfileFields>;
export function missingFields(
  profile: Partial<ProfileFields> | null | undefined,
  fields?: readonly ProfileField[],
): ProfileField[];

export interface DbAdapter {
  dialect: "postgres" | "sqlite";
  query(text: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
}
export interface StoreOptions {
  table?: string;
  key?: string;
  keyType?: string;
  /** Force the SQL dialect for a client that could be either. */
  dialect?: "postgres" | "sqlite";
}
export interface ProfileStore {
  readonly table: string;
  readonly key: string;
  migrate(): Promise<{ created: boolean; added: string[] }>;
  get(userId: string | number): Promise<Profile | null>;
  getByEmail(email: string): Promise<Profile | null>;
  save(userId: string | number, profile: Partial<ProfileFields>): Promise<Profile>;
  fillBlanks(userId: string | number, profile: Partial<ProfileFields>): Promise<Profile>;
  remove(userId: string | number): Promise<void>;
  list(opts?: { limit?: number; after?: string | null; since?: string | null }): Promise<{
    profiles: Profile[];
    next: string | null;
  }>;
  all(opts?: { limit?: number; since?: string | null }): AsyncGenerator<Profile>;
}
/**
 * postgres.js or Bun SQL, a pg Pool/Client, @libsql/client or @profullstack/libsql-pg,
 * bun:sqlite or better-sqlite3, a server-side supabase-js client, or a DbAdapter.
 */
export function createProfileStore(db: unknown, options?: StoreOptions): ProfileStore;
export function migrate(
  dbOrStore: unknown,
  options?: StoreOptions,
): Promise<{ created: boolean; added: string[] }>;
export function schemaSql(options?: StoreOptions & { dialect?: "postgres" | "sqlite" }): string;
export function adapt(db: unknown, dialect?: "postgres" | "sqlite"): DbAdapter | { dialect: "supabase"; client: unknown };

export interface SessionUser {
  id: string | number;
  email?: string | null;
}
export interface HandlerOptions {
  store: ProfileStore;
  getUser(request: Request, ...rest: unknown[]): SessionUser | null | Promise<SessionUser | null>;
  required?: readonly ProfileField[];
  onSaved?(profile: Profile, user: SessionUser): unknown;
}
export function createProfileHandlers(options: HandlerOptions): {
  GET(request: Request, ...rest: unknown[]): Promise<Response>;
  PUT(request: Request, ...rest: unknown[]): Promise<Response>;
  PATCH(request: Request, ...rest: unknown[]): Promise<Response>;
};
export function mountProfileRoutes<T>(app: T, options: HandlerOptions & { path?: string }): T;
export function saveSignupProfile(
  store: ProfileStore,
  userId: string | number,
  input: ProfileInput,
  options?: { email?: string | null; required?: readonly ProfileField[] },
): Promise<ValidationResult & { profile: Partial<ProfileFields> | Profile }>;

export interface RenderOptions {
  values?: Partial<Record<ProfileField, string | null>>;
  errors?: Partial<Record<ProfileField, string>>;
  required?: readonly ProfileField[];
  fields?: readonly ProfileField[];
  idPrefix?: string;
  className?: string;
  labels?: Partial<Record<ProfileField, string>>;
}
export function renderProfileFields(options?: RenderOptions): string;
export const PROFILE_ENHANCE_SCRIPT: string;

export interface CsvOptions {
  columns?: readonly string[];
  delimiter?: string;
}
export function csvCell(v: unknown, delimiter?: string): string;
export function csvHeader(options?: CsvOptions): string;
export function csvRow(profile: Partial<Record<string, unknown>>, options?: CsvOptions): string;
export function toCsv(profiles: Partial<Record<string, unknown>>[], options?: CsvOptions): string;
