/**
 * Chat turn orchestrator (local-first).
 *
 * Persists the user turn, calls the stateless AI backend, persists every
 * returned text/media record locally, and emits a render model. Refreshing or
 * reopening the conversation always reads from IndexedDB, never from a
 * transient DOM state.
 */
(function () {
  var MEDIA_FOLLOWUPS = [
    'Hope you liked it!',
    'How is it?',
    'Hope I didn\'t disappoint',
    'Here, it\'s not the best tho.',
    'Let me know what you think 😊',
    'Was that okay? 🥰',
    'Tell me honestly… 👀'
  ];

  var EMOJI_FALLBACK_ACK = {
    IMAGE: "Wait—okay, give me a second… *fixes her hair* here goes. 📸",
    VIDEO: "You want a video? *laughs* alright, let me get ready. 🎥",
    VOICE: "Hold on… *clears her throat* okay, recording. 🎙️",
  };
  var CALL_FALLBACK = 'Stay right there… I\'m calling you. 📞';
  var ERROR_FALLBACK = "Something went wrong on my end — give me a moment and try again. 💕";

  function nowIso() { return new Date().toISOString(); }
  function pickFollowUp() {
    return MEDIA_FOLLOWUPS[Math.floor(Math.random() * MEDIA_FOLLOWUPS.length)];
  }
  function dataUrlToBlob(dataUrl) {
    var m = /^data:([^;,]+);base64,(.*)$/s.exec(String(dataUrl || ''));
    if (!m) throw new Error('Unsupported media data');
    var bytes = atob(m[2]);
    var arr = new Uint8Array(bytes.length);
    for (var i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return new Blob([arr], { type: m[1] });
  }
  function base64ToBlob(base64, mimeType) {
    var bytes = atob(String(base64 || ''));
    var arr = new Uint8Array(bytes.length);
    for (var i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return new Blob([arr], { type: mimeType || 'application/octet-stream' });
  }
  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(blob);
    });
  }

  function ChatEngine(options) {
    this.userId = options.userId;
    this.character = options.character || {};
    this.conversation = options.conversation;
    this.onEvent = options.onEvent || function () {};
    this.sending = false;
    this.urlCache = Object.create(null);
    this.activePending = Object.create(null);
    this._destroyed = false;
  }

  ChatEngine.prototype.emit = function (type, payload) {
    if (this._destroyed) return;
    try { this.onEvent(type, payload); } catch (e) { console.warn('[ChatEngine] event handler failed', e); }
  };

  ChatEngine.prototype.init = async function () {
    if (!window.YoursStorage) throw new Error('Storage layer unavailable');
    var ready = await window.YoursStorage.initialize();
    if (!ready.ok) throw ready.error || new Error('Local storage initialization failed');
    if (!this.conversation) {
      this.conversation = await window.LocalStore.ensureConversation(this.userId, this.character.id, this.character.name);
    }
    if (this.conversation && this.character && this.character.id) {
      await window.LocalStore.updateConversation(this.conversation.id, { characterSnapshot: this.character });
    }
    return this.conversation;
  };

  ChatEngine.prototype._cacheUrl = async function (media) {
    if (!media || !media.id) return null;
    if (this.urlCache[media.id]) return this.urlCache[media.id];
    if (media.status === 'generating') return null;
    try {
      var blob = await window.OpfsStorage.getBlob(media);
      if (!blob) return null;
      var url = URL.createObjectURL(blob);
      this.urlCache[media.id] = url;
      return url;
    } catch (e) {
      return null;
    }
  };

  ChatEngine.prototype._dropUrl = function (mediaId) {
    if (!mediaId) return;
    if (this.urlCache[mediaId]) {
      try { URL.revokeObjectURL(this.urlCache[mediaId]); } catch (e) {}
      delete this.urlCache[mediaId];
    }
  };

  /**
   * A generation interrupted by a refresh/close would otherwise shimmer
   * forever. Anything still marked "generating" with no live generation in
   * this session is converted to a normal in-character failure bubble.
   */
  ChatEngine.prototype._cleanStalePending = async function (messages) {
    var changed = false;
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      if (m.status !== 'generating' || this.activePending[m.id]) continue;
      if (m.mediaId) {
        try { await window.LocalStore.updateMedia(m.mediaId, { status: 'failed', error: 'interrupted' }); } catch (e) {}
      }
      await window.LocalStore.updateMessage(m.id, {
        status: 'failed',
        content: m.kind === 'voice'
          ? "My mic just cut out — give me a second and try again. 💕"
          : "Hmm, the camera's being fussy — give me a moment and try again. 💕",
        mediaId: null,
        mediaKind: null,
      });
      changed = true;
    }
    return changed;
  };

  /** Build the render model (messages + resolved local media URLs). */
  ChatEngine.prototype.load = async function () {
    var messages = await window.LocalStore.getMessages(this.conversation.id, 600);
    if (await this._cleanStalePending(messages)) {
      messages = await window.LocalStore.getMessages(this.conversation.id, 600);
    }
    var out = [];
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      var media = null;
      var mediaUrl = null;
      if (m.mediaId) {
        media = await window.LocalStore.getMedia(m.mediaId);
        if (media) mediaUrl = await this._cacheUrl(media);
      }
      out.push(Object.assign({}, m, { media: media, mediaUrl: mediaUrl }));
    }
    return out;
  };

  ChatEngine.prototype.releaseUrls = function () {
    var keys = Object.keys(this.urlCache);
    for (var i = 0; i < keys.length; i++) {
      try { URL.revokeObjectURL(this.urlCache[keys[i]]); } catch (e) {}
    }
    this.urlCache = Object.create(null);
  };

  ChatEngine.prototype._history = async function (limit, excludeTurnId) {
    var messages = await window.LocalStore.getMessages(this.conversation.id, limit || 16);
    var out = [];
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      // The current user turn is sent separately as `userMessage`; including
      // it here would create two consecutive identical user turns.
      if (excludeTurnId && m.clientTurnId === excludeTurnId) continue;
      var content = m.content;
      if (!content) {
        if (m.kind === 'image') content = '[Photo]';
        else if (m.kind === 'video') content = '[Video]';
        else if (m.kind === 'voice') content = '[Voice message]';
      }
      out.push({ role: m.role === 'user' ? 'user' : 'character', content: content });
    }
    return out;
  };

  ChatEngine.prototype._latestMediaOfKind = async function (kind) {
    var messages = await window.LocalStore.getMessages(this.conversation.id, 400);
    for (var i = messages.length - 1; i >= 0; i--) {
      var m = messages[i];
      if (!m.mediaId) continue;
      var media = await window.LocalStore.getMedia(m.mediaId);
      if (!media || media.status !== 'completed' || media.kind !== kind) continue;
      if (media.source === 'upload') continue; // never edit the user's own upload
      return media;
    }
    return null;
  };

  ChatEngine.prototype._saveUserAttachment = async function (dataUrl) {
    if (!dataUrl) return null;
    var id = window.LocalStore.uuid();
    var blob = dataUrlToBlob(dataUrl);
    var mimeType = blob.type || 'image/jpeg';
    var stored = await window.OpfsStorage.save(id, blob, mimeType);
    return window.LocalStore.addMedia({
      id: id,
      userId: this.userId,
      conversationId: this.conversation.id,
      characterId: this.character.id,
      kind: 'image',
      mimeType: mimeType,
      fileName: 'attachment.' + (stored.ext || 'jpg'),
      sizeBytes: blob.size,
      storage: stored.storage,
      path: stored.path,
      ext: stored.ext,
      status: 'completed',
      source: 'upload',
      provider: 'user',
    });
  };

  ChatEngine.prototype._persistMessage = async function (data) {
    return window.LocalStore.addMessage(this.conversation.id, Object.assign({
      characterId: this.character.id,
      clientTurnId: this.turnId,
    }, data));
  };

  ChatEngine.prototype._ackText = function (intent) {
    return EMOJI_FALLBACK_ACK[intent] || "Okay… one sec. 💕";
  };

  ChatEngine.prototype._generateMedia = async function (request, opts) {
    var kind = request.type;
    var mediaId = window.LocalStore.uuid();
    var pending = await window.LocalStore.addMedia({
      id: mediaId,
      userId: this.userId,
      conversationId: this.conversation.id,
      characterId: this.character.id,
      kind: kind.toLowerCase(),
      mimeType: kind === 'IMAGE' ? 'image/jpeg' : (kind === 'VIDEO' ? 'video/mp4' : 'audio/mpeg'),
      status: 'generating',
      source: 'generated',
      provider: kind === 'VOICE' ? 'fish-audio' : 'deapi',
      prompt: request.prompt,
    });

    var pendingMessage = await this._persistMessage({
      role: 'character',
      content: '',
      kind: kind.toLowerCase(),
      mediaId: pending.id,
      mediaKind: kind.toLowerCase(),
      status: 'generating',
    });
    this.activePending[pendingMessage.id] = true;
    this.emit('render', await this.load());
    this.emit('typing', { mode: kind.toLowerCase(), pending: true });

    try {
      var blob, mimeType, transcript = null, provider = pending.provider;
      if (kind === 'IMAGE' || kind === 'VIDEO') {
        var payload = {
          userId: this.userId,
          characterId: this.character.id,
          prompt: request.prompt,
          usesPreviousMedia: !!request.usesPreviousMedia,
        };
        if (request.usesPreviousMedia) {
          try {
            var prev = await this._latestMediaOfKind(kind === 'IMAGE' ? 'image' : 'video');
            if (prev) {
              var prevBlob = await window.OpfsStorage.getBlob(prev);
              if (prevBlob) payload.referenceImage = await blobToDataUrl(prevBlob);
            }
          } catch (e) {}
        }
        var result = kind === 'IMAGE'
          ? await window.YoursAPI.aiGenerateImage(payload)
          : await window.YoursAPI.aiGenerateVideo(payload);
        if (!result || !result.dataUrl) throw new Error('Generation returned no media');
        mimeType = result.mimeType || (kind === 'IMAGE' ? 'image/jpeg' : 'video/mp4');
        blob = dataUrlToBlob(result.dataUrl);
      } else {
        var history = await this._history(8, this.turnId);
        var voice = await window.YoursAPI.aiGenerateVoice({
          userId: this.userId,
          characterId: this.character.id,
          prompt: request.prompt,
          history: history,
        });
        if (!voice || !voice.audioBase64) throw new Error('Voice generation returned no audio');
        mimeType = voice.mimeType || 'audio/mpeg';
        transcript = voice.transcript || null;
        blob = base64ToBlob(voice.audioBase64, mimeType);
      }

      var stored = await window.OpfsStorage.save(mediaId, blob, mimeType);
      var updated = await window.LocalStore.updateMedia(mediaId, {
        status: 'completed',
        mimeType: mimeType,
        sizeBytes: blob.size,
        storage: stored.storage,
        path: stored.path,
        ext: stored.ext,
        transcript: transcript,
        error: null,
      });
      this._dropUrl(mediaId);

      await window.LocalStore.updateMessage(pendingMessage.id, {
        status: 'sent',
        mediaKind: kind.toLowerCase(),
        content: transcript || '',
        metadata: transcript ? { transcript: transcript } : null,
      });

      // Persist a short follow-up so it survives refresh too.
      var followUp = pickFollowUp();
      await this._persistMessage({
        role: 'character',
        content: followUp,
        kind: 'text',
      });

      delete this.activePending[pendingMessage.id];
      this.emit('typing', null);
      this.emit('render', await this.load());
      return updated;
    } catch (err) {
      console.error('[ChatEngine] media generation failed:', err);
      await window.LocalStore.updateMedia(mediaId, { status: 'failed', error: (err && err.message) || String(err) });
      await window.LocalStore.updateMessage(pendingMessage.id, {
        status: 'failed',
        content: kind === 'VOICE'
          ? "My mic just cut out — give me a second and try again. 💕"
          : "Hmm, the camera's being fussy — give me a moment and try again. 💕",
        mediaId: null,
        mediaKind: null,
      });
      delete this.activePending[pendingMessage.id];
      this.emit('typing', null);
      this.emit('render', await this.load());
      this.emit('error', err);
      return null;
    }
  };

  ChatEngine.prototype._callAllowed = async function (trigger) {
    if (trigger !== 'emotion') return true;
    var key = 'call_cooldown_' + this.userId + '_' + this.character.id;
    var last = await window.LocalStore.getSetting(key, 0);
    var cooldown = 15 * 60 * 1000; // short cooldown for spontaneous calls
    if (last && Date.now() - Number(last) < cooldown) return false;
    await window.LocalStore.setSetting(key, Date.now(), this.userId);
    return true;
  };

  /**
   * Send one user turn.
   * opts: { text, imageDataUrl, forceIntent }
   */
  ChatEngine.prototype.send = async function (opts) {
    if (this.sending) return null;
    opts = opts || {};
    var text = String(opts.text || '').trim();
    if (!text && !opts.imageDataUrl) return null;

    this.sending = true;
    this.turnId = window.LocalStore.uuid();
    var self = this;

    try {
      var attachment = null;
      if (opts.imageDataUrl) attachment = await this._saveUserAttachment(opts.imageDataUrl);

      await this._persistMessage({
        role: 'user',
        content: text,
        kind: attachment ? 'image' : 'text',
        mediaId: attachment ? attachment.id : null,
        mediaKind: attachment ? 'image' : null,
      });
      this.emit('render', await this.load());
      this.emit('typing', { mode: 'typing' });

      // Local RAG retrieval. Skip until the embedding model is warm so the
      // first message is never delayed by a model download.
      var memories = [];
      try {
        if (window.YoursMemory && window.YoursMemory.isReady()) {
          memories = await Promise.race([
            window.YoursMemory.retrieve(this.userId, this.character.id, text, 5),
            new Promise(function (resolve) { setTimeout(function () { resolve([]); }, 3500); }),
          ]);
        } else if (window.YoursMemory) {
          window.YoursMemory.warm();
        }
      } catch (e) { memories = []; }

      var history = await this._history(16, this.turnId);
      var mediaMessages = await window.LocalStore.getMessages(this.conversation.id, 60);
      var hasPreviousMedia = mediaMessages.some(function (m) { return !!m.mediaId; });

      var result = await window.YoursAPI.aiRespond({
        userId: this.userId,
        characterId: this.character.id,
        history: history,
        userMessage: { text: text, image: opts.imageDataUrl || null },
        forceIntent: opts.forceIntent || null,
        hasPreviousMedia: hasPreviousMedia,
        memories: memories.map(function (m) { return m.content; }),
      });

      if (!result || !result.intent) throw new Error('No intent returned');

      var intent = result.intent;
      var mediaRequests = result.intents || [];
      var persistedText = false;

      if (intent === 'TEXT' || intent === 'MIXED' || intent === 'CLARIFICATION') {
        var replyText = intent === 'CLARIFICATION'
          ? (result.clarification || result.reply)
          : result.reply;
        if (replyText) {
          await this._persistMessage({ role: 'character', content: replyText, kind: 'text' });
          persistedText = true;
        }
        // The classifier can propose a call without forcing the VOICE_CALL
        // intent (e.g. strong emotion during a text turn).
        if (result.call && result.call.trigger) {
          if (await this._callAllowed(result.call.trigger)) {
            this.emit('incoming-call', {
              trigger: result.call.trigger,
              reason: result.call.reason || '',
            });
          }
        }
      }

      if (intent === 'VOICE_CALL') {
        var callLine = result.reply || CALL_FALLBACK;
        await this._persistMessage({ role: 'character', content: callLine, kind: 'text' });
        this.emit('typing', null);
        this.emit('render', await this.load());
        var trigger = (result.call && result.call.trigger) || 'explicit';
        if (await this._callAllowed(trigger)) {
          this.emit('incoming-call', { trigger: trigger, reason: (result.call && result.call.reason) || '' });
        }
        this.sending = false;
        this._backgroundMemory(text, callLine);
        return result;
      }

      if (intent === 'IMAGE' || intent === 'VIDEO' || intent === 'VOICE' || mediaRequests.length) {
        var pureMedia = intent === 'IMAGE' || intent === 'VIDEO' || intent === 'VOICE';
        var ack = result.acknowledgement || (pureMedia && mediaRequests[0] ? this._ackText(mediaRequests[0].type) : null);
        if (ack) {
          await this._persistMessage({ role: 'character', content: ack, kind: 'text' });
          persistedText = true;
        }
        this.emit('typing', null);
        this.emit('render', await this.load());

        var lastText = '';
        for (var i = 0; i < mediaRequests.length; i++) {
          var got = await this._generateMedia(mediaRequests[i], opts);
          if (got && got.transcript) lastText = got.transcript;
        }
        this._backgroundMemory(text, result.reply || ack || lastText);
        this.sending = false;
        return result;
      }

      // Never leave the turn without an in-character line.
      if (!persistedText) {
        await this._persistMessage({
          role: 'character',
          content: "I'm right here with you.",
          kind: 'text',
        });
      }
      this.emit('typing', null);
      this.emit('render', await this.load());
      this.sending = false;
      this._backgroundMemory(text, result.reply || '');
      return result;
    } catch (err) {
      console.error('[ChatEngine] send failed:', err);
      var detail = err && err.message ? err.message : String(err);
      var storageMsg = window.YoursStorage ? window.YoursStorage.describeError(err) : detail;
      await this._persistMessage({
        role: 'character',
        content: ERROR_FALLBACK + (window._debugErrors ? (' (' + detail + ')') : ''),
        kind: 'text',
        status: 'failed',
      }).catch(function () {});
      this.emit('typing', null);
      this.emit('render', await this.load().catch(function () { return []; }));
      this.emit('error', { error: err, message: storageMsg });
      this.sending = false;
      return null;
    }
  };

  ChatEngine.prototype._backgroundMemory = function (userText, aiText) {
    if (!window.YoursMemory || !userText) return;
    var self = this;
    setTimeout(function () {
      window.YoursMemory.indexTurn(self.userId, self.character.id, self.conversation.id, userText, aiText)
        .catch(function () {});
    }, 0);
  };

  ChatEngine.prototype.seedIfEmpty = async function (greeting) {
    var count = await window.LocalStore.countMessages(this.conversation.id);
    if (count > 0) return false;
    await this._persistMessage({
      role: 'character',
      content: greeting || ('Hey, I\'m ' + (this.character.name || 'here') + '. I\'m so happy you found me — tell me about your day! 💕'),
      kind: 'text',
    });
    this.emit('render', await this.load());
    return true;
  };

  ChatEngine.prototype.reset = async function () {
    await window.LocalStore.resetCharacter(this.userId, this.character.id);
    // Recreate the conversation record so the chat keeps working.
    this.conversation = await window.LocalStore.ensureConversation(this.userId, this.character.id, this.character.name);
    if (this.character && this.character.id) {
      await window.LocalStore.updateConversation(this.conversation.id, { characterSnapshot: this.character });
    }
    this.releaseUrls();
    await this.seedIfEmpty('Fresh start... what shall we talk about? ✨');
  };

  ChatEngine.prototype.destroy = function () {
    this._destroyed = true;
    this.releaseUrls();
  };

  window.ChatEngine = ChatEngine;
})();
