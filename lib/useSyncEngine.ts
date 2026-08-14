'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  getPendingSyncItems,
  getPendingCount,
  updateSyncItemStatus,
} from './offlineDB';

export interface SyncEngineState {
  pendingCount: number;
  isSyncing: boolean;
  justSynced: boolean; // true briefly after a successful sync round
}

/**
 * Watches online/offline state and automatically syncs pending
 * IndexedDB queue items to the server when connectivity returns.
 *
 * @param isOnline      - live online status from useOnlineStatus
 * @param onSyncComplete - called after each sync round (use to reload fresh data from API)
 */
export function useSyncEngine(
  isOnline: boolean,
  onSyncComplete: () => void
): SyncEngineState {
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing,    setIsSyncing]    = useState(false);
  const [justSynced,   setJustSynced]   = useState(false);

  // Keep a stable ref to onSyncComplete so we don't re-create sync on every render
  const onSyncCompleteRef = useRef(onSyncComplete);
  useEffect(() => { onSyncCompleteRef.current = onSyncComplete; });

  // Prevent concurrent sync runs
  const isSyncingRef = useRef(false);

  // ── Pending count refresher ─────────────────────────────────────────────────
  const refreshCount = useCallback(async () => {
    try {
      const n = await getPendingCount();
      setPendingCount(n);
    } catch { /* IndexedDB not available in SSR */ }
  }, []);

  // ── Core sync function ──────────────────────────────────────────────────────
  const runSync = useCallback(async () => {
    if (isSyncingRef.current) return;

    let items;
    try {
      items = await getPendingSyncItems();
    } catch {
      return;
    }

    // Nothing pending — just refresh data from server
    if (items.length === 0) {
      await refreshCount();
      onSyncCompleteRef.current();
      return;
    }

    isSyncingRef.current = true;
    setIsSyncing(true);

    let anySynced = false;

    for (const item of items) {
      // Abort if we went offline mid-sync
      if (!navigator.onLine) {
        await updateSyncItemStatus(item.id, 'pending');
        continue;
      }

      try {
        await updateSyncItemStatus(item.id, 'syncing');

        const res = await fetch('/api/sync', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ operations: [item] }),
        });

        if (res.ok) {
          const data = await res.json();
          const opResult = data?.results?.[0];
          if (opResult?.success !== false) {
            await updateSyncItemStatus(item.id, 'synced');
            anySynced = true;
          } else {
            // Server rejected — keep as pending for retry
            await updateSyncItemStatus(item.id, 'pending');
          }
        } else if (res.status >= 500) {
          // Server error — keep pending for retry
          await updateSyncItemStatus(item.id, 'pending');
        } else {
          // Client error (4xx) — mark failed, won't be retried automatically
          await updateSyncItemStatus(item.id, 'failed');
        }
      } catch {
        // Network error mid-item — reset to pending
        await updateSyncItemStatus(item.id, 'pending');
      }
    }

    isSyncingRef.current = false;
    setIsSyncing(false);
    await refreshCount();

    if (anySynced) {
      setJustSynced(true);
      setTimeout(() => setJustSynced(false), 3500);
      // Reload fresh data from server now that everything is synced
      onSyncCompleteRef.current();
    }
  }, [refreshCount]);

  // ── Trigger sync when coming online ────────────────────────────────────────
  useEffect(() => {
    if (isOnline) {
      runSync();
    } else {
      // Just refresh count when going offline
      refreshCount();
    }
  }, [isOnline, runSync, refreshCount]);

  // ── Poll pending count every 5 s (catches changes from other tabs) ──────────
  useEffect(() => {
    refreshCount();
    const id = setInterval(refreshCount, 5000);
    return () => clearInterval(id);
  }, [refreshCount]);

  return { pendingCount, isSyncing, justSynced };
}
