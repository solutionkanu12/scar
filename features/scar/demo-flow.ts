/** Presentation-only shortening; backend lifecycle state is never modeled here. */
export function formatActionReference(actionId: string): string {
  return actionId.length > 24
    ? `${actionId.slice(0, 14)}…${actionId.slice(-8)}`
    : actionId;
}
