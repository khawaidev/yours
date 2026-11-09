/**
 * Local repositories for conversations, messages, media, memories and settings.
 *
 * All user content lives here (IndexedDB) and in OPFS. The backend is only
 * called for AI inference/generation and never receives persisted chat data.
 */
(function () {
  function db() {
    if (!window.YoursDB) throw new Error('Local storage unavailable');
    return window.YoursDB;
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function nowIso() { return new Date().toISOString(); }

  function normaliseLimit(limit, fallback) {
    var n = parseInt(limit, 10);
    if (!isFinite(n) || n <= 0) return fallback || 200;
    return Math.min(n, 2000);
  }

  var LocalStore = {
    uuid: uuid,

    // ---------------- Conversations ----------------

    async getConversation(userId, characterId) {
      return db().conversations.where('[userId+characterId]').equals([userId, characterId]).first();
    },

    async getConversationById(id) {
      return db().conversations.get(id);
    },

    /** Get or create the single local conversation for a user + character. */
    async ensureConversation(userId, characterId, characterName) {
      if (!userId) throw new Error('userId required');
      if (!characterId) throw new Error('characterId required');
      var existing = await this.getConversation(userId, characterId);
      if (existing) return existing;
      var now = nowIso();
      var conv = {
        id: uuid(),
        userId: userId,
        characterId: characterId,
        title: characterName || null,
        createdAt: now,
        updatedAt: now,
        nextSequence: 0,
        summary: null,
      };
      try {
        await db().conversations.add(conv);
        return conv;
      } catch (err) {
        // Race: another tab created it first.
        var again = await this.getConversation(userId, characterId);
        if (again) return again;
        throw err;
      }
    },

    async listConversations(userId) {
      var rows = await db().conversations.where('userId').equals(userId).toArray();
      return rows.sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
    },

    /** Persist a lightweight character snapshot for offline chat-list rendering. */
    async updateConversation(id, patch) {
      var conv = await db().conversations.get(id);
      if (!conv) return null;
      Object.assign(conv, patch || {});
      await db().conversations.put(conv);
      return conv;
    },

    async deleteConversation(conversationId) {
      // Read the media rows first: removing OPFS/IDB blobs must happen outside
      // the Dexie transaction (awaiting non-Dexie promises would let it commit).
      var media = await db().media.where('conversationId').equals(conversationId).toArray();
      await db().transaction('rw', db().conversations, db().messages, db().media, async function () {
        await db().media.where('conversationId').equals(conversationId).delete();
        await db().messages.where('conversationId').equals(conversationId).delete();
        await db().conversations.delete(conversationId);
      });
      for (var i = 0; i < media.length; i++) {
        if (window.OpfsStorage) {
          try { await window.OpfsStorage.remove(media[i]); } catch (e) { /* best effort */ }
        }
      }
    },

    // ---------------- Messages ----------------

    /**
     * Append one message and assign the next monotonic sequence atomically.
     * `data`: { role, content, characterId, mediaId, mediaKind, status,
     *           metadata, clientTurnId, createdAt }
     */
    async addMessage(conversationId, data) {
      var self = this;
      return db().transaction('rw', db().conversations, db().messages, async function () {
        var conv = await db().conversations.get(conversationId);
        if (!conv) throw new Error('Conversation not found');
        var seq = (conv.nextSequence || 0) + 1;
        var createdAt = data.createdAt || nowIso();
        var msg = {
          id: data.id || uuid(),
          conversationId: conversationId,
          userId: conv.userId,
          characterId: data.characterId || conv.characterId,
          role: data.role || 'character',
          content: data.content == null ? '' : String(data.content),
          createdAt: createdAt,
          sequence: seq,
          status: data.status || 'sent',
          mediaId: data.mediaId || null,
          mediaKind: data.mediaKind || null,
          clientTurnId: data.clientTurnId || null,
          metadata: data.metadata || null,
          kind: data.kind || 'text', // text | image | video | voice | system
        };
        await db().messages.put(msg);
        conv.nextSequence = seq;
        conv.updatedAt = createdAt;
        if (!conv.title && data.title) conv.title = data.title;
        await db().conversations.put(conv);
        return msg;
      });
    },

    /** Insert many messages preserving chronological order and assigning sequences. */
    async addMessages(conversationId, list) {
      if (!list || !list.length) return [];
      var sorted = list.slice().sort(function (a, b) {
        return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
      });
      return db().transaction('rw', db().conversations, db().messages, async function () {
        var conv = await db().conversations.get(conversationId);
        if (!conv) throw new Error('Conversation not found');
        var seq = conv.nextSequence || 0;
        var out = [];
        for (var i = 0; i < sorted.length; i++) {
          var data = sorted[i];
          seq += 1;
          var msg = {
            id: data.id || uuid(),
            conversationId: conversationId,
            userId: conv.userId,
            characterId: data.characterId || conv.characterId,
            role: data.role || 'character',
            content: data.content == null ? '' : String(data.content),
            createdAt: data.createdAt || nowIso(),
            sequence: seq,
            status: data.status || 'sent',
            mediaId: data.mediaId || null,
            mediaKind: data.mediaKind || null,
            clientTurnId: data.clientTurnId || null,
            metadata: data.metadata || null,
            kind: data.kind || 'text',
          };
          await db().messages.put(msg);
          conv.updatedAt = msg.createdAt;
          out.push(msg);
        }
        conv.nextSequence = seq;
        await db().conversations.put(conv);
        return out;
      });
    },

    /**
     * Recompute the per-conversation `sequence` values from `createdAt`.
     * Used after a legacy import merges older messages into an existing local
     * conversation so the chat renders in true chronological order.
     */
    async rebuildSequences(conversationId) {
      return db().transaction('rw', db().conversations, db().messages, async function () {
        var conv = await db().conversations.get(conversationId);
        if (!conv) return 0;
        var rows = await db().messages
          .where('[conversationId+sequence]')
          .between([conversationId, Dexie.minKey], [conversationId, Dexie.maxKey])
          .toArray();
        rows.sort(function (a, b) {
          var byDate = String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
          return byDate !== 0 ? byDate : (a.sequence || 0) - (b.sequence || 0);
        });
        for (var i = 0; i < rows.length; i++) {
          if (rows[i].sequence !== i + 1) {
            rows[i].sequence = i + 1;
            await db().messages.put(rows[i]);
          }
        }
        conv.nextSequence = rows.length;
        if (rows.length) conv.updatedAt = rows[rows.length - 1].createdAt;
        await db().conversations.put(conv);
        return rows.length;
      });
    },

    async updateMessage(messageId, patch) {
      return db().transaction('rw', db().messages, async function () {
        var msg = await db().messages.get(messageId);
        if (!msg) return null;
        Object.assign(msg, patch || {});
        await db().messages.put(msg);
        return msg;
      });
    },

    async deleteMessage(messageId) {
      return db().messages.delete(messageId);
    },

    async getMessages(conversationId, limit) {
      var lim = normaliseLimit(limit, 500);
      var rows = await db().messages
        .where('[conversationId+sequence]')
        .between([conversationId, Dexie.minKey], [conversationId, Dexie.maxKey])
        .toArray();
      rows.sort(function (a, b) { return (a.sequence || 0) - (b.sequence || 0); });
      if (rows.length > lim) rows = rows.slice(rows.length - lim);
      return rows;
    },

    async countMessages(conversationId) {
      return db().messages.where('conversationId').equals(conversationId).count();
    },

    /** Most recent message in a conversation (used by the chat list). */
    async getLastMessage(conversationId) {
      var row = await db().messages
        .where('[conversationId+sequence]')
        .between([conversationId, Dexie.minKey], [conversationId, Dexie.maxKey])
        .last();
      return row || null;
    },

    // ---------------- Media ----------------

    async addMedia(data) {
      var media = Object.assign({
        id: data.id || uuid(),
        userId: data.userId || null,
        conversationId: data.conversationId || null,
        characterId: data.characterId || null,
        kind: data.kind || 'image',
        mimeType: data.mimeType || 'application/octet-stream',
        fileName: data.fileName || null,
        sizeBytes: data.sizeBytes || 0,
        storage: data.storage || null,
        path: data.path || null,
        ext: data.ext || null,
        status: data.status || 'completed', // generating | completed | failed
        source: data.source || 'generated', // generated | upload
        provider: data.provider || null,
        prompt: data.prompt || null,
        transcript: data.transcript || null,
        error: data.error || null,
        createdAt: data.createdAt || nowIso(),
        updatedAt: nowIso(),
      }, data, { id: data.id || uuid() });
      await db().media.put(media);
      return media;
    },

    async getMedia(mediaId) {
      if (!mediaId) return null;
      return db().media.get(mediaId);
    },

    async updateMedia(mediaId, patch) {
      var media = await db().media.get(mediaId);
      if (!media) return null;
      Object.assign(media, patch || {}, { updatedAt: nowIso() });
      await db().media.put(media);
      return media;
    },

    /** List media for a character, newest first. */
    async listCharacterMedia(characterId, userId, kinds) {
      var rows = await db().media.where('[characterId+kind]')
        .between([characterId, Dexie.minKey], [characterId, Dexie.maxKey])
        .toArray();
      rows = rows.filter(function (m) {
        if (userId && m.userId && m.userId !== userId) return false;
        if (m.status === 'failed') return false;
        // The Photos tab shows media the character sent, not images the user
        // attached to their own messages.
        if (m.source === 'upload') return false;
        if (kinds && kinds.length && kinds.indexOf(m.kind) === -1) return false;
        return true;
      });
      return rows.sort(function (a, b) {
        return String(b.createdAt).localeCompare(String(a.createdAt));
      });
    },

    async listConversationMedia(conversationId) {
      var rows = await db().media.where('conversationId').equals(conversationId).toArray();
      return rows.sort(function (a, b) {
        return String(a.createdAt).localeCompare(String(b.createdAt));
      });
    },

    async deleteMedia(mediaId) {
      var media = await db().media.get(mediaId);
      if (media && window.OpfsStorage) await window.OpfsStorage.remove(media);
      return db().media.delete(mediaId);
    },

    /**
     * Resolve display URLs for messages. Returns a map messageId ->
     * { url, revoke } where revoke() releases the object URL.
     * Caller owns the URLs and must revoke them when re-rendering/closing.
     */
    async hydrateMessages(messages) {
      var out = {};
      if (!messages || !messages.length || !window.OpfsStorage) return out;
      var ids = [];
      for (var i = 0; i < messages.length; i++) {
        if (messages[i].mediaId && ids.indexOf(messages[i].mediaId) === -1) ids.push(messages[i].mediaId);
      }
      for (var j = 0; j < ids.length; j++) {
        var media = await this.getMedia(ids[j]);
        if (!media) continue;
        try {
          var blob = await window.OpfsStorage.getBlob(media);
          if (!blob) continue;
          var url = URL.createObjectURL(blob);
          out[media.id] = {
            url: url,
            media: media,
            revoke: (function (u) { return function () { try { URL.revokeObjectURL(u); } catch (e) {} }; })(url),
          };
        } catch (e) {
          console.warn('[LocalStore] media hydrate failed', media.id, e && e.message);
        }
      }
      return out;
    },

    // ---------------- Memories / RAG ----------------

    async addMemory(data) {
      var row = Object.assign({
        id: data.id || uuid(),
        userId: data.userId,
        characterId: data.characterId,
        conversationId: data.conversationId || null,
        content: data.content || '',
        type: data.type || 'conversation',
        importance: data.importance == null ? 0.5 : data.importance,
        embedding: data.embedding || null,
        createdAt: data.createdAt || nowIso(),
      }, data, { id: data.id || uuid() });
      await db().memories.put(row);
      return row;
    },

    async listMemories(userId, characterId, limit) {
      var rows = await db().memories.where('[userId+characterId]').equals([userId, characterId]).toArray();
      rows.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
      return rows.slice(0, normaliseLimit(limit, 300));
    },

    async deleteMemory(memoryId) {
      return db().memories.delete(memoryId);
    },

    async clearMemories(userId, characterId) {
      var keys = await db().memories.where('[userId+characterId]').equals([userId, characterId]).primaryKeys();
      return db().memories.bulkDelete(keys);
    },

    // ---------------- Settings ----------------

    async getSetting(key, fallback) {
      var row = await db().settings.get(key);
      if (!row) return fallback;
      return row.value === undefined ? fallback : row.value;
    },

    async setSetting(key, value, userId) {
      await db().settings.put({ key: key, value: value, userId: userId || null, updatedAt: nowIso() });
      return value;
    },

    async deleteSetting(key) {
      return db().settings.delete(key);
    },

    // ---------------- Reset ----------------

    /** Clear all local user content for a character (chat + media + memories). */
    async resetCharacter(userId, characterId) {
      var conv = await this.getConversation(userId, characterId);
      if (conv) await this.deleteConversation(conv.id);
      await this.clearMemories(userId, characterId);
    },
  };

  window.LocalStore = LocalStore;
})();
