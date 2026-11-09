/**
 * Local memory / RAG.
 *
 * Embeddings are computed in a worker (Transformers.js) and stored in
 * IndexedDB. Retrieval uses cosine similarity in the browser. If the model is
 * unavailable the system degrades to recent history + keyword matching.
 */
(function () {
  var worker = null;
  var nextId = 1;
  var pending = {};
  var modelFailed = false;
  var modelReady = false;

  function getWorker() {
    if (worker || modelFailed) return worker;
    try {
      worker = new Worker('js/rag-worker.js');
      worker.onmessage = function (e) {
        var msg = e.data || {};
        var cb = pending[msg.id];
        if (!cb) return;
        delete pending[msg.id];
        if (msg.error) {
          modelFailed = true;
          cb.reject(new Error(msg.error));
        } else {
          modelReady = true;
          cb.resolve(msg.vectors || []);
        }
      };
      worker.onerror = function (err) {
        modelFailed = true;
        // Reject every in-flight request.
        Object.keys(pending).forEach(function (id) {
          try { pending[id].reject(new Error('Embedding worker failed')); } catch (e) {}
          delete pending[id];
        });
        console.warn('[YoursMemory] embedding worker error:', err && err.message);
      };
    } catch (err) {
      modelFailed = true;
      console.warn('[YoursMemory] worker unavailable:', err && err.message);
    }
    return worker;
  }

  function embed(texts, timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (modelFailed) { reject(new Error('Embeddings unavailable')); return; }
      var w = getWorker();
      if (!w) { reject(new Error('Embeddings unavailable')); return; }
      var id = String(nextId++);
      var timer = setTimeout(function () {
        delete pending[id];
        reject(new Error('Embedding timeout'));
      }, timeoutMs || 20000);
      pending[id] = {
        resolve: function (v) { clearTimeout(timer); resolve(v); },
        reject: function (e) { clearTimeout(timer); reject(e); },
      };
      w.postMessage({ id: id, texts: texts });
    });
  }

  function cosine(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    var dot = 0, na = 0, nb = 0;
    for (var i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    if (!na || !nb) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  function tokenize(text) {
    return String(text || '').toLowerCase().match(/[a-z0-9']{3,}/g) || [];
  }

  function keywordScore(query, text) {
    var q = tokenize(query);
    if (!q.length) return 0;
    var t = {};
    tokenize(text).forEach(function (w) { t[w] = (t[w] || 0) + 1; });
    var hits = 0;
    q.forEach(function (w) { if (t[w]) hits += 1; });
    return hits / q.length;
  }

  var Memory = {
    isReady: function () { return modelReady; },
    isFailed: function () { return modelFailed; },

    /** Preload the embedding model without blocking chat. */
    warm: function () {
      if (modelReady || modelFailed) return;
      embed(['warm up'], 60000).catch(function () {});
    },

    /**
     * Retrieve the top-k memories relevant to `query`.
     * Always returns an array (possibly empty) and never throws.
     */
    async retrieve(userId, characterId, query, k) {
      var limit = k || 5;
      if (!window.LocalStore || !userId || !characterId) return [];
      var rows = await window.LocalStore.listMemories(userId, characterId, 400);
      if (!rows.length) return [];

      var queryVec = null;
      try {
        var vectors = await embed([String(query || '').slice(0, 800)], 25000);
        queryVec = vectors && vectors[0];
      } catch (err) {
        // Fall back to keyword ranking silently.
      }

      var scored = rows.map(function (row) {
        var semantic = queryVec && row.embedding ? cosine(queryVec, row.embedding) : 0;
        var lexical = keywordScore(query, row.content);
        var recency = 0;
        var ts = Date.parse(row.createdAt || '');
        if (isFinite(ts)) recency = Math.max(0, 1 - (Date.now() - ts) / (1000 * 60 * 60 * 24 * 90));
        // Semantic dominates when available; lexical keeps it useful offline.
        var score = queryVec ? (semantic * 0.72 + lexical * 0.2 + recency * 0.08)
                             : (lexical * 0.85 + recency * 0.15);
        return { row: row, score: score };
      });

      scored.sort(function (a, b) { return b.score - a.score; });
      return scored.slice(0, limit)
        .filter(function (s) { return s.score > 0.12; })
        .map(function (s) { return { content: s.row.content, type: s.row.type, score: s.score }; });
    },

    /** Index a completed turn as a compact memory. Best-effort. */
    async indexTurn(userId, characterId, conversationId, userText, aiText) {
      if (!window.LocalStore || !userId || !characterId) return;
      var user = String(userText || '').trim();
      var ai = String(aiText || '').trim();
      if (user.length < 12 && ai.length < 12) return;
      var content = ('User said: ' + user.slice(0, 400) +
        (ai ? ' | Character replied: ' + ai.replace(/\*[^*]*\*/g, '').slice(0, 400) : '')).trim();

      // Cheap dedupe against the most recent memories.
      try {
        var recent = await window.LocalStore.listMemories(userId, characterId, 40);
        var needle = user.slice(0, 80).toLowerCase();
        for (var i = 0; i < recent.length; i++) {
          if (String(recent[i].content || '').toLowerCase().indexOf(needle) !== -1) return;
        }
      } catch (e) {}

      var embedding = null;
      try {
        var vectors = await embed([content], 25000);
        embedding = vectors && vectors[0];
      } catch (err) {
        // Store the memory without an embedding; keyword search still works.
      }

      await window.LocalStore.addMemory({
        userId: userId,
        characterId: characterId,
        conversationId: conversationId,
        content: content.slice(0, 700),
        type: 'conversation',
        importance: 0.5,
        embedding: embedding,
      });
    },

    /** Store an explicit user/character fact (e.g. from a future settings UI). */
    async addFact(userId, characterId, conversationId, content) {
      if (!window.LocalStore) return null;
      var embedding = null;
      try {
        var vectors = await embed([content.slice(0, 800)], 25000);
        embedding = vectors && vectors[0];
      } catch (e) {}
      return window.LocalStore.addMemory({
        userId: userId,
        characterId: characterId,
        conversationId: conversationId,
        content: content,
        type: 'fact',
        importance: 0.8,
        embedding: embedding,
      });
    },

    clear: function (userId, characterId) {
      if (!window.LocalStore) return Promise.resolve();
      return window.LocalStore.clearMemories(userId, characterId);
    },
  };

  window.YoursMemory = Memory;
})();
