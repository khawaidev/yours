/**
 * Yours AI Companion Platform - API Client Library
 * Connects Frontend HTML pages to Node.js / Supabase Backend Server
 */
const API_BASE_URL = window.LOCATION_API_BASE_URL || 'http://localhost:5000/api/v1';

class YoursAPI {
  /**
   * Helper to perform fetch requests
   */
  static async request(endpoint, options = {}) {
    const url = `${API_BASE_URL}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

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
  static async getPricingForCountry(countryCode) {
    const query = countryCode ? `?country=${countryCode}` : '';
    return this.request(`/pricing/regions${query}`);
  }

  // --- AUTH & PROFILE ---
  static async bootstrapProfile(profileData) {
    return this.request('/auth/profile', {
      method: 'POST',
      body: JSON.stringify(profileData),
    });
  }

  static async updateOnboardingState(userId, state, preferences) {
    return this.request('/auth/onboarding', {
      method: 'POST',
      body: JSON.stringify({ userId, state, preferences }),
    });
  }

  // --- CHARACTERS ---
  static async getPublicCharacters() {
    return this.request('/characters');
  }

  static async getCharacter(characterId) {
    return this.request(`/characters/${characterId}`);
  }

  static async saveCharacter(userId, characterId) {
    return this.request(`/characters/${characterId}/save`, {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });
  }

  // --- CONVERSATIONS & MESSAGES ---
  static async getOrCreateConversation(userId, characterId) {
    return this.request('/conversations', {
      method: 'POST',
      body: JSON.stringify({ userId, characterId }),
    });
  }

  static async getMessages(conversationId) {
    return this.request(`/conversations/${conversationId}/messages`);
  }

  static async sendMessage(conversationId, userId, characterId, content) {
    return this.request(`/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ userId, characterId, content }),
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
  static async getWallet(userId) {
    return this.request(`/wallet?userId=${userId}`);
  }

  // --- TELEMETRY / ANALYTICS ---
  static async trackEvent(eventName, payload = {}, userId = null) {
    return this.request('/analytics/events', {
      method: 'POST',
      body: JSON.stringify({ userId, eventName, payload }),
    });
  }
}

window.YoursAPI = YoursAPI;
