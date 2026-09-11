/**
 * Request lifecycle state machine (product-spec section 5).
 * Kept in a dependency-free module so the transition table is unit-tested
 * directly against the spec — the service enforces this exact table.
 */
export const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['IN_PROGRESS', 'CANCELLED', 'REJECTED'],
  IN_PROGRESS: ['COMPLETED', 'REJECTED'],
};

export function canTransition(from: string, to: string): boolean {
  return (VALID_TRANSITIONS[from] || []).includes(to);
}
