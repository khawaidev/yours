/**
 * Yours local database (Dexie / IndexedDB).
 *
 * This is the canonical store for user content:
 *   - conversations, messages, generated media metadata
 *   - local memories + embeddings (RAG)
 *   - settings (migration state, call cooldowns, preferences)
 *
 * Binary media lives in OPFS when available, with an IndexedDB Blob fallback
 * (see opfs.js). Nothing here is uploaded to Supabase or R2.
 */
(function () {
  if (!window.Dexie) {
    console.error('[YoursDB] Dexie failed to load; local persistence unavailable.');
    return;
  }

  var db = new Dexie('yours_local');

  // v1 — initial local-first schema.
  db.version(1).stores({
    // One conversation per (userId, characterId).
    conversations: 'id, userId, characterId, &[userId+characterId], updatedAt',

    // Message ordering uses a per-conversation monotonic `sequence` so it is
    // stable even if the device clock changes.
    messages: 'id, clientTurnId, conversationId, characterId, [conversationId+sequence], [conversationId+createdAt], status, createdAt',

    // One row per generated/uploaded object. The chat bubble and the character
    // Photos section both reference the same row + the same OPFS object.
    media: 'id, conversationId, characterId, userId, kind, status, createdAt, [characterId+kind], [conversationId+createdAt]',

    // Local long-term memory + embeddings.
    memories: 'id, userId, characterId, conversationId, createdAt, [userId+characterId]',

    // IndexedDB Blob fallback for browsers without OPFS.
    blobs: 'id',

    // Key/value settings. `key` is globally unique (prefix with userId when
    // the setting is per-user).
    settings: 'key, userId',
  });

  // v2 — future migrations can be added here without losing data.
  // db.version(2).stores({ ... });

  db.on('versionchange', function () {
    try { db.close(); } catch (e) {}
  });

  window.YoursDB = db;
})();
