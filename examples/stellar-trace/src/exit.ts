/**
 * Exit codes, shared by both commands so that a number means one thing.
 *
 * Distinct codes rather than a bare 1, because the differences matter to
 * whatever runs these: a filter mismatch is a mistake to fix, a retention gap
 * is history that no longer exists, and a transaction that is not found may
 * simply be older than the RPC server's window.
 */
export const EXIT = {
  usage: 2,
  wrongNetwork: 3,
  retentionGap: 4,
  filterMismatch: 5,
  notFound: 6,
} as const;
