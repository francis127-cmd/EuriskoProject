import { normalizeSlug } from './company-slug';

describe('normalizeSlug', () => {
  it.each([
    ['Acme Corp', 'acme-corp'],
    ['  Francissolutions  ', 'francissolutions'],
    ['IT & Support!', 'it-support'],
    ['---weird---name---', 'weird-name'],
    ['UPPER lower 123', 'upper-lower-123'],
    ['a', 'a'],
  ])('normalizes %j to %j', (raw, expected) => {
    expect(normalizeSlug(raw)).toBe(expected);
  });

  it.each([[''], ['   '], ['---'], ['!!!']])('returns empty for %j', (raw) => {
    expect(normalizeSlug(raw)).toBe('');
  });
});
