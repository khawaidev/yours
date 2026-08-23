/**
 * Yours — Desktop shell renderer
 * ------------------------------------------------------------
 * Injects the shared desktop chrome (sidebar, topbar, footer)
 * into placeholder elements on desktop pages:
 *
 *   <div id="ds-sidebar"></div>  (optional; fixed position anyway)
 *   <div id="ds-topbar"></div>
 *   ... page content ...
 *   <footer id="ds-footer"></footer>
 *
 * Page declares its active nav item with:
 *   <body class="ds-page" data-active-nav="create">
 * and an optional topbar title via:
 *   <body data-topbar-title="My AI">
 *
 * Requires: js/api-client.js (loaded before this file).
 */
(function () {
  'use strict';

  var LOGO_URL =
    'https://pub-475cca0b7414418d866128a4b30dfd97.r2.dev/images/yours/file_000000003704823093c6cccb8ba71cd1.png';
  var FAVICON_URL =
    'https://pub-475cca0b7414418d866128a4b30dfd97.r2.dev/images/yours/file_000000006a2c81fa833aa9f0571bfffc.png';

  // Supabase config — same project as the mobile pages.
  var SUPABASE_URL = 'https://dgbxcakkqrgrapwsvrol.supabase.co';
  var SUPABASE_ANON_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRnYnhjYWtrcXJncmFwd3N2cm9sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxOTM0NDksImV4cCI6MjEwMTc2OTQ0OX0.v2gOgC28bfXXVjRVki1lL0ulgCHVloUAv1eF5HVSzuk';

  var NAV_ITEMS = [
    { id: 'create', label: 'Create', icon: 'fa-solid fa-wand-magic-sparkles', href: 'desktop-create.html' },
    { id: 'explore', label: 'Explore', icon: 'fa-solid fa-compass', href: 'desktop-index.html' },
    { id: 'feed', label: 'Feed', icon: 'fa-solid fa-fire', href: 'feeds-desktop.html' },
    { id: 'chats', label: 'Chats', icon: 'fa-solid fa-comment-dots', href: 'messaging.html' },
    { id: 'myai', label: 'My AI', icon: 'fa-solid fa-heart', href: 'myai.html' }
  ];

  var NAV_SECONDARY = [
    { label: 'Recharge', icon: 'fa-solid fa-coins', href: 'recharge.html' },
    { label: 'Gifts', icon: 'fa-solid fa-gift', href: 'sent-gifts.html' },
    { label: 'Settings', icon: 'fa-solid fa-gear', href: 'settings.html' },
    { label: 'Legal & Safety', icon: 'fa-solid fa-shield-halved', href: 'legal.html' }
  ];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function renderSidebar(active) {
    var host = document.getElementById('ds-sidebar');
    if (!host) return;
    // Pages that don't use the full .ds-layout shell still need their
    // content shifted right of the fixed sidebar.
    if (!document.querySelector('.ds-layout')) {
      document.body.classList.add('has-ds-sidebar');
    }
    host.classList.add('ds-sidebar');
    var html = '';
    html += '<a class="ds-logo" href="desktop-index.html" aria-label="Yours home">';
    html += '<img src="' + LOGO_URL + '" alt="Yours"></a>';

    html += '<nav class="ds-nav-group" aria-label="Primary">';
    NAV_ITEMS.forEach(function (item) {
      html +=
        '<a class="ds-nav-item' + (active === item.id ? ' is-active' : '') + '" href="' + item.href + '">' +
        '<i class="' + item.icon + '" aria-hidden="true"></i><span>' + item.label + '</span></a>';
    });
    html += '</nav>';

    html += '<p class="ds-nav-label">Account</p>';
    html += '<nav class="ds-nav-group" aria-label="Account">';
    NAV_SECONDARY.forEach(function (item) {
      html +=
        '<a class="ds-nav-item" href="' + item.href + '">' +
        '<i class="' + item.icon + '" aria-hidden="true"></i><span>' + item.label + '</span></a>';
    });
    html += '</nav>';

    html += '<div class="ds-sidebar-spacer"></div>';
    html +=
      '<a class="ds-upgrade-card" href="premium-acess.html"><strong>Go Premium</strong>' +
      '<span class="ds-upgrade-desc">Unlimited chats, voice calls and exclusive companions.</span>' +
      '<span class="ds-upgrade-btn"><i class="fa-solid fa-crown" aria-hidden="true"></i>Upgrade</span></a>';
    html += '<p class="ds-sidebar-foot">\u00a9 ' + new Date().getFullYear() + ' Yours</p>';

    host.innerHTML = html;
  }

  function renderTopbar() {
    var host = document.getElementById('ds-topbar');
    if (!host) return;
    host.classList.add('ds-topbar');

    var title = document.body.getAttribute('data-topbar-title') || '';
    var html = '<h1 class="ds-topbar-title">' + esc(title) + '</h1>';
    html += '<div class="ds-topbar-actions" id="ds-topbar-actions"></div>';
    host.innerHTML = html;

    paintTopbarActions();
  }

  function paintTopbarActions() {
    var box = document.getElementById('ds-topbar-actions');
    if (!box) return;
    var user = window.YoursAPI ? YoursAPI.getCurrentUser() : null;

    if (!user) {
      box.innerHTML =
        '<a class="ds-btn" href="auth.html">Log in</a>' +
        '<a class="ds-btn ds-btn-primary" href="auth.html?mode=signup">Sign up free</a>';
      return;
    }

    var name = user.displayName || (user.email || '').split('@')[0] || 'You';
    var avatar = user.avatarUrl ||
      'data:image/svg+xml;utf8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="76" height="76">' +
        '<rect width="100%" height="100%" fill="#262626"/>' +
        '<text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-size="34" fill="#f5f5f7" font-family="sans-serif">' +
        esc(name.charAt(0).toUpperCase()) + '</text></svg>');

    box.innerHTML =
      '<a class="ds-wallet-chip" href="recharge.html" title="Your balance">' +
      '<i class="fa-solid fa-coins" aria-hidden="true"></i><span id="ds-wallet-balance">&hellip;</span></a>' +
      '<a href="user-profile.html" title="' + esc(name) + '"><img class="ds-avatar" alt="' + esc(name) + '" src="' + avatar + '"></a>';

    if (user.id && window.YoursAPI) {
      YoursAPI.getWallet(user.id)
        .then(function (res) {
          var el = document.getElementById('ds-wallet-balance');
          var balance = res && res.wallet ? res.wallet.balance : null;
          if (el && balance != null) el.textContent = balance;
          else if (el) el.textContent = '0';
        })
        .catch(function () {
          var el = document.getElementById('ds-wallet-balance');
          if (el) el.textContent = '0';
        });
    }
  }

  function renderFooter() {
    var host = document.getElementById('ds-footer');
    if (!host) return;
    var year = new Date().getFullYear();

    function col(title, links) {
      var lis = links.map(function (l) {
        return '<li><a href="' + l[1] + '">' + l[0] + '</a></li>';
      }).join('');
      return (
        '<div class="ds-footer-col"><p>' + title + '</p><ul>' + lis + '</ul></div>'
      );
    }

    host.innerHTML =
      '<div class="ds-footer-inner">' +
      '<div class="ds-footer-cols">' +
      '<div class="ds-footer-col ds-footer-brand">' +
      '<a href="desktop-index.html"><img src="' + LOGO_URL + '" alt="Yours"></a>' +
      '<p class="ds-footer-tag">Your AI companions, on your terms.</p></div>' +
      col('Product', [
        ['Create', 'desktop-create.html'],
        ['Explore', 'desktop-index.html'],
        ['Feed', 'feeds-desktop.html'],
        ['My AI', 'myai.html'],
        ['Premium', 'premium-acess.html']
      ]) +
      col('Support', [
        ['Help Centre', 'feedbacks/index.html'],
        ['Community Guidelines', 'community-guidelines.html'],
        ['Feedback', 'legal.html'],
        ['Settings', 'settings.html']
      ]) +
      col('Legal', [
        ['Terms of Service', 'terms.html'],
        ['Privacy Policy', 'privacy-policy.html'],
        ['Cookie Policy', 'cookie-policy.html']
      ]) +
      '</div>' +
      '<div class="ds-footer-bottom"><span>\u00a9 ' + year + ' Yours. All rights reserved.</span>' +
      '<span>18+ only. AI-generated companions.</span></div>' +
      '</div>';
    host.classList.add('ds-footer');
  }

  /* ---------- Data helpers ---------- */

  var sb = null;
  function supabase() {
    if (!sb && window.supabase) {
      sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return sb;
  }

  /**
   * Fetch active public characters (same shape the mobile feed uses).
   * Returns a Promise<array>.
   */
  function loadCharacters() {
    var client = supabase();
    if (!client) return Promise.resolve([]);
    return client
      .from('characters')
      .select('id,name,age,about,gender,personality,message_style,art_style,voice_id,circular_profile_image_url,character_feeds(media_url,media_type)')
      .eq('is_active', true)
      .then(function (_ref) {
        var data = _ref.data;
        return data || [];
      });
  }

  /** Store the picked character and open the existing chat UI. */
  function openChat(character) {
    try {
      sessionStorage.setItem('yours_current_character', JSON.stringify(character));
    } catch (e) { /* ignore */ }
    window.location.href = 'messaging.html';
  }

  /** Best media URL for a character card (feed image > profile pic). */
  function cardImage(character) {
    var feeds = character.character_feeds || [];
    for (var i = 0; i < feeds.length; i++) {
      if (feeds[i].media_type !== 'video') return feeds[i].media_url;
    }
    return character.circular_profile_image_url || '';
  }

  /* ---------- Boot ---------- */

  function ensureFavicon() {
    if (document.querySelector('link[rel="icon"]')) return;
    var link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/png';
    link.href = FAVICON_URL;
    document.head.appendChild(link);
  }

  function init() {
    ensureFavicon();
    renderSidebar(document.body.getAttribute('data-active-nav') || '');
    renderTopbar();
    renderFooter();
    // Re-paint auth area once storage settles (other scripts may sign in).
    setTimeout(paintTopbarActions, 400);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Public helpers.
  window.YoursDesktop = {
    loadCharacters: loadCharacters,
    openChat: openChat,
    cardImage: cardImage,
    refreshAuthUI: paintTopbarActions
  };
})();
