/** Appended to experimental-only preference row labels in account and map settings. */
export const EXPERIMENTAL_SETTING_LABEL_SUFFIX = ' (Experimental)';

export function experimentalSettingLabel(label: string): string {
  return `${label}${EXPERIMENTAL_SETTING_LABEL_SUFFIX}`;
}