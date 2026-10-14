/**
 * Fire-and-forget activity event logger — local no-op version.
 *
 * The backend event log has been removed since TeleDrive is now a free,
 * backend-less application. This module keeps the same export surface so
 * all call sites (useFileActions, remoteSync, etc.) continue to compile
 * without any changes. All events are silently discarded.
 */

/**
 * Known event types — kept for IDE autocomplete.
 */
export type KnownEventType =
  | 'file.uploaded'
  | 'file.renamed'
  | 'file.trashed'
  | 'file.restored'
  | 'file.archived'
  | 'file.unarchived'
  | 'file.starred'
  | 'file.unstarred'
  | 'file.deleted'
  | 'file.deleted.acknowledged'
  | 'folder.created'
  | 'files.moved'
  | 'files.trashed'
  | 'files.restored'
  | 'files.archived'
  | 'files.starred'
  | 'files.unstarred'
  | 'files.deleted'
  | 'sync.remoteDelta'
  | 'backup.manual'
  | 'backup.auto';

export interface LogEventOptions {
  type: KnownEventType | string;
  payload?: Record<string, unknown>;
  occurredAt?: string;
}

/**
 * No-op event logger. All parameters are accepted for API compatibility
 * but nothing is sent anywhere — there is no backend to receive events.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function logEvent(_opts: LogEventOptions): void {
  // intentionally empty — backend removed
}