/**
 * useIsPro — always returns true.
 *
 * TeleDrive is now a fully free application. This hook previously checked
 * the license plan; it now returns true unconditionally so that any
 * remaining call sites get the "unlocked" path without code changes.
 */
export function useIsPro(): boolean {
  return true;
}