/**
 * Yours — Onboarding controller
 * ------------------------------------------------------------
 * Runs on every onboarding step. It owns three things:
 *
 *  1. Progress — one identical bar whose fill is derived from the
 *     step's position in the flow (so it always matches).
 *  2. Answers — choices are saved to sessionStorage as the user
 *     goes, so they survive navigation and can be written to the
 *     new account once the user signs up at the end.
 *  3. Hand-off — finishing the flow sends the visitor to auth.html;
 *     auth.html then either creates the account with these answers
 *     or, for an existing account, throws them away and logs in.
 *
 * Usage on a page:  <script src="js/onboarding.js"></script>
 *   <div class="ys-ob-progress"><span data-ob-progress></span></div>
 */
(function () {
  'use strict';

  // The onboarding flow, in order. Age.html is the first screen.
  var STEPS = [
    'Age.html',
    'name.html',
    'age-interest.html',
    'art-interest.html',
    'eye-interest.html',
    'explore-interest.html',
    'personality-interest.html',
  ];

  var KEY = 'yours_onboarding_v1';
  // Magic links open in a new tab, where sessionStorage starts empty — keep a
  // short-lived backup so the answers still reach the new account.
  var BACKUP_KEY = 'yours_onboarding_backup_v1';
  var BACKUP_TTL = 2 * 60 * 60 * 1000; // 2 hours
  // Last percentage that was drawn, so each page fills on from where the
  // previous one stopped instead of restarting from zero.
  var PROGRESS_KEY = 'yours_onboarding_progress_v1';

  function read() {
    try {
      var raw = sessionStorage.getItem(KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (e) { /* fall through to the backup */ }
    try {
      var backup = JSON.parse(localStorage.getItem(BACKUP_KEY) || 'null');
      if (backup && typeof backup === 'object' && backup.__savedAt &&
          Date.now() - backup.__savedAt < BACKUP_TTL) {
        var copy = Object.assign({}, backup);
        delete copy.__savedAt;
        return copy;
      }
    } catch (e) { /* ignore */ }
    return {};
  }

  function write(data) {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      /* storage full / disabled — onboarding still works, it just won't persist */
    }
    try {
      localStorage.setItem(BACKUP_KEY, JSON.stringify(Object.assign({}, data, { __savedAt: Date.now() })));
    } catch (e) { /* ignore */ }
  }

  function fileName() {
    var parts = (window.location.pathname || '').split('/');
    return parts[parts.length - 1] || 'Age.html';
  }

  /**
   * 1-based position in the flow. Pages declare it explicitly with
   * data-step="N" on the progress container (or <body>), so the bar is
   * correct even when the file is opened under a different name
   * (e.g. /yours/ without the .html suffix). Falls back to the filename.
   */
  function stepNumber() {
    var holder = document.querySelector('[data-ob-progress]');
    var declared = (holder && holder.closest('[data-step]')) || document.querySelector('[data-step]');
    if (declared) {
      var n = parseInt(declared.getAttribute('data-step'), 10);
      if (n >= 1 && n <= STEPS.length) return n;
    }
    var i = STEPS.indexOf(fileName());
    return (i < 0 ? 0 : i) + 1;
  }

  function stepIndex() {
    return stepNumber() - 1;
  }

  // 1 of 7 -> 14%, 7 of 7 -> 100%
  function progressPercent() {
    return Math.round((stepNumber() / STEPS.length) * 100);
  }

  function storedProgress() {
    try {
      var n = Number(sessionStorage.getItem(PROGRESS_KEY));
      return isFinite(n) && n > 0 ? n : 0;
    } catch (e) {
      return 0;
    }
  }

  function renderProgress() {
    var fill = document.querySelector('[data-ob-progress]');
    if (!fill) return;

    var target = progressPercent();
    var from = storedProgress();

    // Never animate backwards: on the first step, or when the visitor walks
    // back through the flow, start from the previous page's value instead of
    // resetting the bar to zero (which made it look like it never filled).
    if (from > target) from = Math.max(0, target - 15);

    fill.style.transition = 'none';
    fill.style.width = from + '%';
    // Force a style flush so the browser registers the starting width before
    // the target is applied — without this both writes land in the same frame
    // and the transition is skipped entirely.
    void fill.offsetWidth;

    requestAnimationFrame(function () {
      fill.style.transition = '';
      requestAnimationFrame(function () {
        fill.style.width = target + '%';
      });
    });

    // Safety net: whatever happens above, the bar must end up at the target.
    setTimeout(function () {
      if (fill.style.width !== target + '%') {
        fill.style.transition = 'none';
        fill.style.width = target + '%';
      }
    }, 700);

    try { sessionStorage.setItem(PROGRESS_KEY, String(target)); } catch (e) {}
  }

  var api = {
    STEPS: STEPS,
    TOTAL: STEPS.length,

    get: function (key) {
      return read()[key];
    },

    set: function (key, value) {
      var data = read();
      data[key] = value;
      write(data);
      return value;
    },

    setMany: function (values) {
      var data = read();
      for (var key in values) {
        if (Object.prototype.hasOwnProperty.call(values, key)) data[key] = values[key];
      }
      write(data);
      return data;
    },

    all: read,
    clear: function () {
      try { sessionStorage.removeItem(KEY); } catch (e) {}
      try { localStorage.removeItem(BACKUP_KEY); } catch (e) {}
    },

    stepIndex: stepIndex,
    progressPercent: progressPercent,
    renderProgress: renderProgress,

    /** Persist an answer and move on to the next screen. */
    go: function (key, value, next) {
      if (key) api.set(key, value);
      window.location.href = next;
    },

    /**
     * Wire a card carousel: the centred card is the current choice, so it is
     * saved as soon as it becomes active (including the initial state).
     */
    bindCarousel: function (options) {
      var root = typeof options.root === 'string' ? document.querySelector(options.root) : options.root;
      if (!root) return null;
      var cards = Array.prototype.slice.call(root.querySelectorAll(options.cardSelector || '.ys-ob-card'));
      var key = options.key;

      function update() {
        if (!cards.length) return null;
        var center = root.scrollLeft + root.clientWidth / 2;
        var best = null;
        var bestDistance = Infinity;
        cards.forEach(function (card) {
          var cardCenter = card.offsetLeft + card.offsetWidth / 2;
          var distance = Math.abs(center - cardCenter);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = card;
          }
        });
        cards.forEach(function (card) {
          var active = card === best;
          card.classList.toggle('is-active', active);
          card.classList.toggle('is-inactive', !active);
        });
        if (best && key) api.set(key, best.getAttribute('data-value'));
        if (best && typeof options.onChange === 'function') options.onChange(best);
        return best;
      }

      cards.forEach(function (card) {
        card.addEventListener('click', function () {
          var target = card.offsetLeft - (root.clientWidth - card.offsetWidth) / 2;
          root.scrollTo({ left: target, behavior: 'smooth' });
        });
      });

      var ticking = false;
      root.addEventListener('scroll', function () {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(function () {
          ticking = false;
          update();
        });
      }, { passive: true });

      update();
      return {
        update: update,
        cards: cards,
        root: root,
        /** Centre a card by its data-value (used to restore a saved choice). */
        select: function (value) {
          var card = cards.filter(function (c) { return c.getAttribute('data-value') === value; })[0];
          if (!card) return;
          root.scrollTo({ left: card.offsetLeft - (root.clientWidth - card.offsetWidth) / 2 });
          update();
        },
      };
    },

    /** Preferences payload for the backend (columns on user_preferences). */
    preferences: function () {
      var d = read();
      var prefs = {};
      if (d.ageInterest) prefs.age_interest = d.ageInterest;
      if (d.artStyle) prefs.art_style = d.artStyle;
      if (d.archetype) prefs.archetypes = [d.archetype];
      if (d.interests && d.interests.length) prefs.relationship_interests = d.interests;
      if (d.personality) prefs.personality_preferences = [d.personality];
      prefs.onboarding_completed = true;
      return prefs;
    },

    /** True when the visitor actually completed (or at least filled) the flow. */
    hasAnswers: function () {
      var d = read();
      return !!(d.name || d.age || d.ageInterest || d.artStyle || d.archetype ||
        (d.interests && d.interests.length) || d.personality);
    },

    /**
     * Write the collected answers onto a freshly created account.
     * Existing accounts never call this — their onboarding data is discarded.
     */
    applyToAccount: function (userId) {
      var d = read();
      if (!userId || !window.YoursAPI) return Promise.resolve(false);
      var jobs = [];
      var profile = {};
      if (d.name) profile.displayName = d.name;
      if (d.age) profile.declaredAge = d.age;
      if (Object.keys(profile).length) {
        jobs.push(window.YoursAPI.updateProfile(userId, profile));
      }
      jobs.push(window.YoursAPI.updateOnboardingState(userId, 'completed', api.preferences()));
      return Promise.all(jobs).then(function () {
        return true;
      }).catch(function () {
        // Never block the user from entering the app if a write fails.
        return false;
      });
    },

    /** End of the flow: mark complete and head to sign-up. */
    finish: function () {
      var data = read();
      data.completedAt = new Date().toISOString();
      write(data);
      window.location.replace('auth.html');
    },
  };

  window.YSOnboarding = api;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderProgress);
  } else {
    renderProgress();
  }
})();
