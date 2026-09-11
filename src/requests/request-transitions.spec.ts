import { VALID_TRANSITIONS, canTransition } from './request-transitions';

describe('request lifecycle state machine (product-spec section 5)', () => {
  it.each([
    ['PENDING', 'IN_PROGRESS'],
    ['PENDING', 'CANCELLED'],
    ['PENDING', 'REJECTED'],
    ['IN_PROGRESS', 'COMPLETED'],
    ['IN_PROGRESS', 'REJECTED'],
  ])('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ['PENDING', 'COMPLETED'],
    ['PENDING', 'PENDING'],
    ['IN_PROGRESS', 'CANCELLED'],
    ['IN_PROGRESS', 'PENDING'],
    ['IN_PROGRESS', 'IN_PROGRESS'],
    ['COMPLETED', 'PENDING'],
    ['COMPLETED', 'IN_PROGRESS'],
    ['COMPLETED', 'REJECTED'],
    ['COMPLETED', 'CANCELLED'],
    ['REJECTED', 'IN_PROGRESS'],
    ['REJECTED', 'COMPLETED'],
    ['CANCELLED', 'PENDING'],
    ['CANCELLED', 'IN_PROGRESS'],
    ['UNKNOWN', 'PENDING'],
    ['PENDING', 'UNKNOWN'],
  ])('rejects %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('treats terminal states as having no outgoing transitions', () => {
    for (const terminal of ['COMPLETED', 'REJECTED', 'CANCELLED']) {
      expect(VALID_TRANSITIONS[terminal]).toBeUndefined();
    }
  });
});
