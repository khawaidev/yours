/**
 * One-time legacy cloud → local migration.
 *
 * Exports the signed-in user's Supabase conversations/messages and generated
 * chat media, downloads every media object into OPFS, verifies the import, and
 * only then purges the cloud copies. Relationship state and call history stay
 * in Supabase by design.
 */
(function () {
  var STATUS_KEY = 'legacy_migration_v1';

  function nowIso() { return new Date().toISOString(); }

  function kindFromMessage(messageType, mediaType) {
    var t = String(messageType || '').toLowerCase();
    if (t === 'image' || t === 'video' || t === 'voice') return t;
    var m = String(mediaType || '').toLowerCase();
    if (m === 'video') return 'video';
    return 'image';
  }

  function extFor(kind, mimeType) {
    if (window.OpfsStorage) return window.OpfsStorage.extForMime(mimeType, kind === 'video' ? 'mp4' : (kind === 'voice' ? 'mp3' : 'jpg'));
    return kind === 'video' ? 'mp4' : (kind === 'voice' ? 'mp3' : 'jpg');
  }

  async function downloadMedia(url) {
    if (!url) throw new Error('Missing media URL');
    try {
      var direct = await fetch(url);
      if (direct.ok) return await direct.blob();
    } catch (e) { /* CORS or network — fall through to the backend proxy */ }
    return window.YoursAPI.fetchLegacyMedia(url);
  }

  async function importMedia(row, kind, userId, conversationId) {
    var existing = await window.LocalStore.getMedia(row.id);
    if (existing && existing.status === 'completed' && existing.storage) return existing;

    var blob = await downloadMedia(row.media_url);
    var mimeType = blob.type || (kind === 'video' ? 'video/mp4' : (kind === 'voice' ? 'audio/mpeg' : 'image/jpeg'));
    var stored = await window.OpfsStorage.save(row.id, blob, mimeType, extFor(kind, mimeType));
    return window.LocalStore.addMedia({
      id: row.id,
      userId: userId,
      conversationId: conversationId || null,
      characterId: row.character_id,
      kind: kind,
      mimeType: mimeType,
      fileName: row.id + '.' + stored.ext,
      sizeBytes: blob.size,
      storage: stored.storage,
      path: stored.path,
      ext: stored.ext,
      status: 'completed',
      source: 'migrated',
      provider: 'legacy-r2',
      createdAt: row.created_at || nowIso(),
    });
  }

  // Only one migration may run at a time. Chat init and the first send both
  // kick it off; sharing the promise prevents duplicate imports/purges.
  async function run(userId, options) {
    if (run._inFlight) return run._inFlight;
    var p = runOnce(userId, options);
    run._inFlight = p;
    try {
      return await p;
    } finally {
      if (run._inFlight === p) run._inFlight = null;
    }
  }

  async function runOnce(userId, options) {
    options = options || {};
    if (!userId || !window.YoursAPI || !window.LocalStore || !window.OpfsStorage) {
      return { ok: false, skipped: true, reason: 'unavailable' };
    }

    var status = await window.LocalStore.getSetting(STATUS_KEY + '_' + userId, null);
    if (status && status.done) return { ok: true, skipped: true, status: status };
    if (status && status.attemptedAt && Date.now() - status.attemptedAt < 60 * 60 * 1000 && !options.force) {
      return { ok: false, skipped: true, reason: 'recent-attempt' };
    }
    await window.LocalStore.setSetting(STATUS_KEY + '_' + userId, Object.assign({}, status || {}, { attemptedAt: Date.now() }), userId);

    var report = { ok: false, importedConversations: 0, importedMessages: 0, importedMedia: 0, importedMemories: 0, orphans: 0, purged: false, errors: [] };

    try {
      var data = await window.YoursAPI.exportLegacyData(userId);
      var conversations = (data && data.conversations) || [];
      var messages = (data && data.messages) || [];

      if (!conversations.length && !messages.length) {
        var emptyStatus = { done: true, at: nowIso(), report: report, reason: 'nothing-to-migrate' };
        await window.LocalStore.setSetting(STATUS_KEY + '_' + userId, emptyStatus, userId);
        return { ok: true, status: emptyStatus };
      }

      // media id → kind, derived from the linked message first.
      var mediaKind = {};
      messages.forEach(function (m) {
        if (m.media_id) mediaKind[m.media_id] = kindFromMessage(m.message_type);
      });

      var mediaCache = {};
      var charByConversation = {};

      // 1. Conversations.
      for (var i = 0; i < conversations.length; i++) {
        var c = conversations[i];
        if (!c.character_id) {
          report.errors.push('conversation ' + c.id + ': missing character id (not imported)');
          continue;
        }
        var conv = await window.LocalStore.ensureConversation(userId, c.character_id, c.title || null);
        mediaCache[c.id] = conv.id;
        charByConversation[c.id] = c.character_id;
        report.importedConversations += 1;
      }

      // 2. Messages (per conversation, chronological).
      var byConversation = {};
      messages.forEach(function (m) {
        if (!m.conversation_id) return;
        (byConversation[m.conversation_id] = byConversation[m.conversation_id] || []).push(m);
      });

      for (var legacyConvId in byConversation) {
        if (!Object.prototype.hasOwnProperty.call(byConversation, legacyConvId)) continue;
        var localConvId = mediaCache[legacyConvId];
        if (!localConvId) continue;

        var list = byConversation[legacyConvId].sort(function (a, b) {
          return String(a.created_at).localeCompare(String(b.created_at));
        });
        var importable = [];
        for (var j = 0; j < list.length; j++) {
          var m = list[j];
          var kind = kindFromMessage(m.message_type);
          var mediaId = null;
          if (m.media_id && m.media_url) {
            try {
              await importMedia({
                id: m.media_id,
                character_id: charByConversation[legacyConvId] || null,
                media_url: m.media_url,
                created_at: m.created_at,
              }, mediaKind[m.media_id] || kind, userId, localConvId);
              mediaId = m.media_id;
              report.importedMedia += 1;
            } catch (e) {
              report.errors.push('media ' + m.media_id + ': ' + (e.message || e));
            }
          } else if (m.media_id) {
            report.errors.push('media ' + m.media_id + ': missing URL');
          }
          importable.push({
            id: m.id,
            role: m.sender_type === 'user' ? 'user' : 'character',
            content: m.content || '',
            kind: mediaId ? mediaKind[m.media_id] || kind : 'text',
            mediaId: mediaId,
            mediaKind: mediaId ? (mediaKind[m.media_id] || kind) : null,
            createdAt: m.created_at || nowIso(),
            status: 'sent',
            metadata: { migrated: true },
          });
        }
        // Merge by id: never duplicate messages that already exist locally.
        var existing = await window.LocalStore.getMessages(localConvId, 5000);
        var existingIds = {};
        existing.forEach(function (x) { existingIds[x.id] = true; });
        var fresh = importable.filter(function (m) { return !existingIds[m.id]; });
        if (fresh.length) {
          await window.LocalStore.addMessages(localConvId, fresh);
          await window.LocalStore.rebuildSequences(localConvId);
          report.importedMessages += fresh.length;
        }
      }

      // 3. Orphaned media (in Photos but no message): create a media message so
      //    recovered images appear in the conversation too.
      var orphans = (data && data.orphanMedia) || [];
      for (var k = 0; k < orphans.length; k++) {
        var o = orphans[k];
        var kindO = kindFromMessage(null, o.media_type);
        try {
          var convO = await window.LocalStore.ensureConversation(userId, o.character_id, null);
          var convMessages = await window.LocalStore.getMessages(convO.id, 1);
          var existingMedia = await window.LocalStore.getMedia(o.id);
          if (!existingMedia) {
            await importMedia(o, kindO, userId, convO.id);
            report.importedMedia += 1;
          }
          // Only add a recovery bubble once.
          var all = await window.LocalStore.getMessages(convO.id, 1000);
          var already = all.some(function (x) { return x.mediaId === o.id; });
          if (!already) {
            await window.LocalStore.addMessage(convO.id, {
              role: 'character',
              content: '',
              kind: kindO,
              mediaId: o.id,
              mediaKind: kindO,
              createdAt: o.created_at || nowIso(),
              metadata: { recovered: true },
            });
            report.orphans += 1;
            report.importedMessages += 1;
          }
        } catch (e) {
          report.errors.push('orphan ' + o.id + ': ' + (e.message || e));
        }
      }

      // 4. Long-term memories (text only; embeddings are rebuilt locally).
      var memoryRows = (data && data.memories) || [];
      for (var mi = 0; mi < memoryRows.length; mi++) {
        var mem = memoryRows[mi];
        if (!mem) continue;
        if (!mem.content) continue;
        if (!mem.character_id) {
          // A memory we cannot attribute would be silently lost; block purge.
          report.errors.push('memory ' + (mem.id || '?') + ': missing character id');
          continue;
        }
        try {
          await window.LocalStore.addMemory({
            id: mem.id || undefined,
            userId: userId,
            characterId: mem.character_id,
            content: String(mem.content),
            type: mem.memory_type || 'fact',
            importance: mem.importance == null ? 0.5 : Number(mem.importance),
            createdAt: mem.created_at || nowIso(),
          });
          report.importedMemories += 1;
        } catch (e) {
          report.errors.push('memory ' + (mem.id || '?') + ': ' + (e.message || e));
        }
      }

      // 5. Verify every media row has readable bytes.
      var verifyFailures = [];
      var mediaRows = await window.YoursDB.media.toArray();
      for (var v = 0; v < mediaRows.length; v++) {
        var row = mediaRows[v];
        if (row.userId && row.userId !== userId) continue;
        if (!row.path && !row.storage) continue;
        var blob = await window.OpfsStorage.getBlob(row);
        if (!blob || blob.size === 0) verifyFailures.push(row.id);
      }
      if (verifyFailures.length) {
        report.errors.push('Unreadable media after import: ' + verifyFailures.length);
        throw new Error('Verification failed: ' + verifyFailures.length + ' media files unreadable');
      }

      report.ok = report.errors.length === 0;

      // 6. Purge cloud copies only after a clean verification (no import errors).
      if (report.ok) {
        try {
          var purge = await window.YoursAPI.purgeLegacyData(userId);
          report.purged = !!(purge && purge.success);
          if (purge && purge.errors && purge.errors.length) {
            report.errors = report.errors.concat(purge.errors.map(function (e) { return 'purge: ' + e; }));
          }
        } catch (e) {
          report.errors.push('purge: ' + (e.message || e));
        }
      }

      var finalStatus = {
        done: report.ok,
        at: nowIso(),
        report: report,
        purged: report.purged,
      };
      await window.LocalStore.setSetting(STATUS_KEY + '_' + userId, finalStatus, userId);
      window.dispatchEvent(new CustomEvent('yours:migration', { detail: finalStatus }));
      return finalStatus;
    } catch (err) {
      report.errors.push(err && err.message ? err.message : String(err));
      var failed = { done: false, at: nowIso(), attemptedAt: Date.now(), report: report };
      await window.LocalStore.setSetting(STATUS_KEY + '_' + userId, failed, userId).catch(function () {});
      console.warn('[YoursMigrate] failed:', err);
      window.dispatchEvent(new CustomEvent('yours:migration', { detail: failed }));
      return failed;
    }
  }

  window.YoursMigrate = {
    run: run,
    status: function (userId) {
      return window.LocalStore.getSetting(STATUS_KEY + '_' + userId, null);
    },
  };
})();
