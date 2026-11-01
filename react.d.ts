import type { ReactElement } from "react";
import type { ProfileField, RenderOptions } from "./index.js";

export interface ProfileFieldsProps extends RenderOptions {
  /** Controlled values; pass with onChange. */
  values?: Partial<Record<ProfileField, string | null>>;
  onChange?(values: Partial<Record<ProfileField, string | null>>): void;
  /** Initial values when uncontrolled. */
  defaultValues?: Partial<Record<ProfileField, string | null>>;
  disabled?: boolean;
  /** Override the default same-origin profile request when the app uses custom auth. */
  importOpenProfileFetcher?(url: string): Promise<Partial<Record<ProfileField, string>>>;
}

export function ProfileFields(props: ProfileFieldsProps): ReactElement;
