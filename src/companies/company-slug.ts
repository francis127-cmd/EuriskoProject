/**
 * Company slug normalization. Single source of truth so API validation,
 * uniqueness checks, and tests all agree on what a slug looks like.
 */
export function normalizeSlug(raw: string): string {
  return (raw || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
