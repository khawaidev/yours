/**
 * Yours AI Companion Platform - API Client Library
 * Connects Frontend HTML pages to Node.js / Supabase Backend Server
 */
const API_BASE_URL =
  window.LOCATION_API_BASE_URL ||
  ('http://' + (window.location.hostname || 'localhost') + ':5000/api/v1');

class YoursAPI {
  // In-memory cache bucket (per-page lifetime). sessionStorage is used as a
  // persistence layer for the larger, rarely-changing reads (characters).
  static _mem = {};

  /**
   * TTL-memoized async helper. `fetcher` must return a Promise. Results are
   * kept in memory (and optionally sessionStorage) for `ttl` ms, so repeated
   * reads across pages skip the network.
   */
  static _cached(key, ttl, fetcher, persist = false) {
    const now = Date.now();
    const hit = YoursAPI._mem[key];
    if (hit && now - hit.ts < ttl) return Promise.resolve(hit.val);
    if (persist) {
      try {
        const raw = sessionStorage.getItem('yours_cache_' + key);
        if (raw) {
          const c = JSON.parse(raw);
          if (c && now - c.ts < ttl) {
            YoursAPI._mem[key] = c;
            return Promise.resolve(c.val);
          }
        }
      } catch (e) {}
    }
    return Promise.resolve(fetcher()).then(function (val) {
      YoursAPI._mem[key] = { ts: now, val: val };
      if (persist) {
        try { sessionStorage.setItem('yours_cache_' + key, JSON.stringify({ ts: now, val: val })); } catch (e) {}
      }
      return val;
    });
  }

  /** Drop a single cache key (memory + sessionStorage). */
  static _bust(key) {
    delete YoursAPI._mem[key];
    try { sessionStorage.removeItem('yours_cache_' + key); } catch (e) {}
  }

  /** Read the current Supabase access token from browser storage. */
  static getAccessToken() {
    const keys = [
      'supabase.auth.token',
      'sb-dgbxcakkqrgrapwsvrol-auth-token',
      'sb-dgbxcakkqrgrapwsvrol-auth-token-code-verifier',
    ];
    let raw = null;
    for (const k of keys) {
      if (raw) break;
      try { raw = localStorage.getItem(k); } catch (e) {}
      if (!raw) { try { raw = sessionStorage.getItem(k); } catch (e) {} }
    }
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      const s = parsed.currentSession || parsed;
      if (s && typeof s.access_token === 'string') return s.access_token;
    } catch (e) {}
    // Fallback: storage may hold the raw JWT string itself.
    if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw)) return raw;
    return null;
  }

  /**
   * Helper to perform fetch requests
   */
  static async request(endpoint, options = {}) {
    const url = `${API_BASE_URL}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    // Attach the caller's session token so the backend can verify identity.
    const token = YoursAPI.getAccessToken();
    if (token) headers.Authorization = 'Bearer ' + token;

    try {
      const response = await fetch(url, { ...options, headers });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `HTTP error ${response.status}`);
      }
      return data;
    } catch (err) {
      console.error(`API Error [${endpoint}]:`, err);
      throw err;
    }
  }

  // --- PRICING ---
  static async getPricingForCountry(countryCode, fresh) {
    const q = new URLSearchParams();
    if (countryCode) q.set('country', countryCode);
    if (fresh) q.set('fresh', '1');
    const query = q.toString() ? `?${q.toString()}` : '';
    return this.request(`/pricing/regions${query}`);
  }

  /**
   * Best-effort country detection from the browser locale.
   * Returns an ISO-2 country code (e.g. 'IN', 'US') or 'US' as a safe default.
   */
  static detectCountry() {
    try {
      const cached = sessionStorage.getItem('yours_country');
      if (cached) return cached;
    } catch (e) {}
    let code = '';
    try {
      const locale =
        (navigator.language || navigator.languages?.[0] || '').toLowerCase() || '';
      const match = locale.match(/(?:^|-)([a-z]{2})(?:$|-)/);
      if (match && match[1]) code = match[1].toUpperCase();
    } catch (e) {}
    if (!code) {
      try {
        const region = Intl.DateTimeFormat().resolvedOptions().locale;
        const m = region.match(/[_-]([A-Za-z]{2})$/);
        if (m) code = m[1].toUpperCase();
      } catch (e) {}
    }
    if (!code) code = 'US';
    try { sessionStorage.setItem('yours_country', code); } catch (e) {}
    return code;
  }

  /**
   * Detect the user's actual location from their IP (async).
   * Tries a couple of free, CORS-enabled IP geolocation services and falls
   * back to the locale-based `detectCountry()` on failure. Results are cached
   * in sessionStorage so repeat calls are instant and cheap.
   */
  static async detectLocation() {
    try {
      const cached = sessionStorage.getItem('yours_country');
      if (cached) return cached;
    } catch (e) {}

    const services = ['https://ipwho.is/', 'https://ipapi.co/json/'];
    for (let i = 0; i < services.length; i++) {
      const url = services[i];
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(function () { ctrl.abort(); }, 4000);
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) continue;
        const data = await res.json();
        const code = (data.country_code2 || data.country_code || data.countryCode || '').toUpperCase();
        if (/^[A-Z]{2}$/.test(code)) {
          try { sessionStorage.setItem('yours_country', code); } catch (e) {}
          return code;
        }
      } catch (e) { /* try next service */ }
    }

    const code = this.detectCountry();
    try { sessionStorage.setItem('yours_country', code); } catch (e) {}
    return code;
  }

  /**
   * Fetch regional pricing for the detected (or provided) country.
   * Pass `fresh=true` to bypass the backend cache (used right before opening
   * the payment sheet so the shown price is the current DB price).
   */
  static async getCountryPricing(countryCode, fresh) {
    const code = countryCode || this.detectCountry();
    const res = await this.getPricingForCountry(code, fresh);
    return res.pricing || null;
  }

  /**
   * Fetch token top-up packs from the backend (DB-driven, cached).
   * Pass `fresh=true` to bypass the backend cache.
   */
  static async getTokenPacks(fresh) {
    const query = fresh ? '?fresh=1' : '';
    return this.request(`/pricing/token-packs${query}`);
  }

  // --- PAYMENTS (Razorpay) ---
  static async getPaymentCatalog(fresh) {
    const query = fresh ? '?fresh=1' : '';
    return this.request(`/payments/catalog${query}`);
  }

  static async getSubscription(userId) {
    return this.request(`/payments/subscription?userId=${encodeURIComponent(userId)}`);
  }

  static async createPaymentOrder(userId, itemId, country) {
    return this.request('/payments/order', {
      method: 'POST',
      body: JSON.stringify({ userId, itemId, country }),
    });
  }

  static async verifyPayment(userId, { orderId, paymentId, signature, itemId }) {
    return this.request('/payments/verify', {
      method: 'POST',
      body: JSON.stringify({ userId, orderId, paymentId, signature, itemId }),
    });
  }

  // --- AUTH & PROFILE ---
  static async bootstrapProfile(profileData) {
    return this.request('/auth/profile', {
      method: 'POST',
      body: JSON.stringify(profileData),
    });
  }

  /**
   * Update mutable profile fields (name, declared age). Only the fields you
   * pass get changed; pass { displayName } and/or { declaredAge }.
   */
  static async updateProfile(userId, { displayName, declaredAge } = {}) {
    const body = { userId };
    if (displayName !== undefined) body.displayName = displayName;
    if (declaredAge !== undefined) body.declaredAge = declaredAge;
    return this.request('/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  // --- PLAN / SUBSCRIPTION STATUS ---
  /**
   * Resolve whether the user is on a paid (Pro) plan.
   * Asks the backend subscription endpoint; falls back to the cached
   * 'yours_plan' value so the app still works offline.
   * Returns a Promise<boolean>.
   */
  static async isPro(userId) {
    try {
      if (userId) {
        const res = await this.getSubscription(userId);
        const sub = res && res.subscription;
        if (sub && sub.plan_type) {
          const isPaid = sub.plan_type === 'plus' || sub.plan_type === 'premium';
          const active = sub.status !== 'cancelled' && sub.status !== 'expired';
          return isPaid && active;
        }
      }
    } catch (e) {
      // Fall through to the cached value below.
    }
    try {
      return localStorage.getItem('yours_plan') === 'pro';
    } catch (e) {
      return false;
    }
  }

  /**
   * Resolve the current signed-in user from the persisted Supabase session.
   * supabase-js v2 stores the session in localStorage under 'supabase.auth.token'
   * (older pages read sessionStorage, which is always empty for v2).
   * Returns { id, email, displayName, avatarUrl } or null when signed out.
   */
  static getCurrentUser() {
    return YoursAPI.getUserFromStorage();
  }

  /**
   * Read the persisted Supabase session from browser storage and extract the
   * current user. Tries localStorage first (supabase-js v2 default), then
   * sessionStorage (legacy). Handles both storage key formats:
   *   - 'supabase.auth.token' (older supabase-js v2)
   *   - 'sb-<project-ref>-auth-token' (newer supabase-js v2 default)
   */
  static getUserFromStorage() {
    const keys = [
      'supabase.auth.token',
      'sb-dgbxcakkqrgrapwsvrol-auth-token',
      'sb-dgbxcakkqrgrapwsvrol-auth-token-code-verifier',
    ];
    let sess = null;
    for (const k of keys) {
      if (sess) break;
      try { sess = localStorage.getItem(k); } catch (e) {}
      if (!sess) { try { sess = sessionStorage.getItem(k); } catch (e) {} }
    }
    if (!sess) return null;
    try {
      const parsed = JSON.parse(sess);
      const u = (parsed.currentSession && parsed.currentSession.user) || parsed.user || null;
      if (!u || !u.id) return null;
      const meta = u.user_metadata || {};
      return {
        id: u.id,
        email: u.email || meta.email || null,
        displayName: meta.full_name || meta.name || null,
        avatarUrl: meta.avatar_url || meta.picture || null,
      };
    } catch (e) {
      return null;
    }
  }

  static async updateOnboardingState(userId, state, preferences) {
    return this.request('/auth/onboarding', {
      method: 'POST',
      body: JSON.stringify({ userId, state, preferences }),
    });
  }

  static async deleteAccount(userId) {
    return this.request('/auth/account', {
      method: 'DELETE',
      body: JSON.stringify({ userId }),
    });
  }

  // --- CHARACTERS ---
  static getPublicCharacters() {
    return this._cached('characters', 5 * 60 * 1000, function () {
      return YoursAPI.request('/characters');
    }, true);
  }

  static getCharacter(characterId) {
    return this._cached('character_' + characterId, 10 * 60 * 1000, function () {
      return YoursAPI.request(`/characters/${characterId}`);
    }, true);
  }

  static async saveCharacter(userId, characterId) {
    return this.request(`/characters/${characterId}/save`, {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });
  }

  static async unsaveCharacter(userId, characterId) {
    return this.request(`/characters/${characterId}/save`, {
      method: 'DELETE',
      body: JSON.stringify({ userId }),
    });
  }

  static getSavedCharacters(userId) {
    return this._cached('saved_' + userId, 3 * 60 * 1000, function () {
      return YoursAPI.request(`/characters/saved?userId=${encodeURIComponent(userId)}`);
    }, true);
  }

  static async generateCharacterImage(characterId, prompt, userId, conversationId) {
    const body = { prompt };
    if (userId) body.userId = userId;
    if (conversationId) body.conversationId = conversationId;
    return this.request(`/characters/${characterId}/generate-image`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  static async generateVoiceMessage(characterId, prompt, userId, conversationId) {
    const body = { prompt };
    if (userId) body.userId = userId;
    if (conversationId) body.conversationId = conversationId;
    return this.request(`/characters/${characterId}/generate-voice`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  // Private album: photos the current user generated in chat with a character.
  // Cached by the caller (sessionStorage) so reloads don't hit the API again.
  static async getCharacterChatMedia(characterId, userId) {
    return this.request(`/characters/${characterId}/chat-media?userId=${encodeURIComponent(userId)}`);
  }

  // --- CONVERSATIONS & MESSAGES ---
  static async getOrCreateConversation(userId, characterId) {
    return this.request('/conversations', {
      method: 'POST',
      body: JSON.stringify({ userId, characterId }),
    });
  }

  static getMessages(conversationId, userId) {
    const q = userId ? `?userId=${encodeURIComponent(userId)}` : '';
    return this._cached('messages_' + conversationId, 15 * 1000, function () {
      return YoursAPI.request(`/conversations/${conversationId}/messages${q}`);
    });
  }

  static async sendMessage(conversationId, userId, characterId, content, imageDataUrl) {
    const body = { userId, characterId, content };
    if (imageDataUrl) body.image = imageDataUrl;
    return this.request(`/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify(body),
    }).then(function (res) {
      // A new message was written, so the cached history is stale.
      YoursAPI._bust('messages_' + conversationId);
      return res;
    });
  }

  static async resetConversation(conversationId, userId) {
    return this.request(`/conversations/${conversationId}`, {
      method: 'DELETE',
      body: JSON.stringify({ userId }),
    }).then(function (res) {
      YoursAPI._bust('messages_' + conversationId);
      return res;
    });
  }

  // --- MEDIA ASSETS (Cloudflare R2) ---
  static async getUploadUrl(filename, mimeType) {
    return this.request('/media/upload-url', {
      method: 'POST',
      body: JSON.stringify({ filename, mimeType }),
    });
  }

  static async createMediaAsset(assetMetadata) {
    return this.request('/media/assets', {
      method: 'POST',
      body: JSON.stringify(assetMetadata),
    });
  }

  static async getMediaAsset(mediaId) {
    return this.request(`/media/${mediaId}`);
  }

  // --- WALLET & CREDITS ---
  static getWallet(userId) {
    return this._cached('wallet_' + userId, 30 * 1000, function () {
      return YoursAPI.request(`/wallet?userId=${encodeURIComponent(userId)}`);
    });
  }

  /**
   * Deduct `amount` credits from the user's wallet (atomic ledger).
   * Bumps the cached wallet so the UI balance stays correct immediately.
   */
  static async spend(userId, amount, description) {
    return this.request('/wallet/spend', {
      method: 'POST',
      body: JSON.stringify({ userId, amount: Number(amount), description }),
    }).then(function (res) {
      YoursAPI._bust('wallet_' + userId);
      return res;
    });
  }

  // --- GIFTS HISTORY ---
  // Gifts a user sent to a character (newest first). characterId optional.
  static async getGifts(userId, characterId) {
    let q = `/gifts?userId=${encodeURIComponent(userId)}`;
    if (characterId) q += `&characterId=${encodeURIComponent(characterId)}`;
    return this.request(q);
  }

  // Record a gift the user sent to a character.
  static async sendGift(userId, characterId, giftName, giftImage) {
    return this.request('/gifts', {
      method: 'POST',
      body: JSON.stringify({ userId, characterId, giftName, giftImage: giftImage || null }),
    });
  }

  // --- DAILY LOGIN REWARDS ---
  static async getDailyReward(userId) {
    return this.request(`/rewards/daily?userId=${encodeURIComponent(userId)}`);
  }

  static async claimDailyReward(userId, pro = false) {
    return this.request('/rewards/daily/claim', {
      method: 'POST',
      body: JSON.stringify({ userId, pro: !!pro }),
    }).then(function (res) {
      // The reward credits change the wallet balance.
      YoursAPI._bust('wallet_' + userId);
      return res;
    });
  }

  // --- TELEMETRY / ANALYTICS ---
  static async trackEvent(eventName, payload = {}, userId = null) {
    return this.request('/analytics/events', {
      method: 'POST',
      body: JSON.stringify({ userId, eventName, payload }),
    });
  }

  // --- AI VOICE CALLS ---
  /** Begin a voice call. Returns { callId, call }. */
  static async startCall(userId, characterId, conversationId) {
    return this.request('/calls', {
      method: 'POST',
      body: JSON.stringify({ userId, characterId, conversationId: conversationId || null }),
    });
  }

  /** Finish a call with metrics; backend drops a "Call ended (time)" bubble. */
  static async endCall(callId, userId, metrics) {
    return this.request(`/calls/${encodeURIComponent(callId)}/end`, {
      method: 'POST',
      body: JSON.stringify({ userId, metrics: metrics || {} }),
    });
  }

  /** Save post-call feedback (rating, issues, comment) → Supabase + Telegram. */
  static async submitCallFeedback(callId, userId, { rating, issues, comment } = {}) {
    return this.request(`/calls/${encodeURIComponent(callId)}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ userId, rating: rating || null, issues: issues || [], comment: comment || '' }),
    });
  }

  /** Build the live-call WebSocket URL from the REST base (ws://host:PORT/api/v1/calls/live). */
  static getCallWebSocketUrl() {
    const base = (window.LOCATION_API_BASE_URL || API_BASE_URL).replace(/^http/, 'ws').replace(/\/api\/v1\/?$/, '');
    return base + '/api/v1/calls/live';
  }
}

window.YoursAPI = YoursAPI;
