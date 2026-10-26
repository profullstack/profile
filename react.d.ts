import type { ReactElement } from "react";
import type { ProfileField, RenderOptions } from "./index.js";

export interface ProfileFieldsProps extends RenderOptions {
  /** Controlled values; pass with onChange. */
  values?: Partial<Record<ProfileField, string | null>>;
  onChange?(values: Partial<Record<ProfileField, string | null>>): void;
  /** Initial values when uncontrolled. */
  defaultValues?: Partial<Record<ProfileField, string | null>>;
  disabled?: boolean;
}

export function ProfileFields(props: ProfileFieldsProps): ReactElement;
