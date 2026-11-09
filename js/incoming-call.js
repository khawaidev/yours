/**
 * Character-initiated incoming-call overlay.
 *
 * Shows a full-screen ringing screen with the character's rounded profile,
 * name and a slide-to-answer / slide-to-decline control. Only rings while the
 * app is open (true background ringing would need push notifications).
 */
(function () {
  var STYLE_ID = 'ic-styles';
  var root = null;
  var els = null;
  var active = null;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.ic-root{position:fixed;inset:0;z-index:2147482800;display:none;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;touch-action:none;}',
      '.ic-root.open{display:flex;}',
      '.ic-bg{position:absolute;inset:0;background-size:cover;background-position:center;filter:blur(22px) brightness(.42) saturate(1.2);transform:scale(1.15);}',
      '.ic-shade{position:absolute;inset:0;background:radial-gradient(circle at 50% 32%,rgba(255,62,134,.18),transparent 55%),linear-gradient(to top,rgba(0,0,0,.88),rgba(0,0,0,.35));}',
      '.ic-content{position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;text-align:center;padding:0 2rem;}',
      '.ic-avatar{width:132px;height:132px;border-radius:9999px;overflow:hidden;border:3px solid rgba(255,255,255,.28);box-shadow:0 18px 60px rgba(0,0,0,.55);position:relative;background:#1a1a1a;}',
      '.ic-avatar img{width:100%;height:100%;object-fit:cover;display:block;}',
      '.ic-avatar:after{content:"";position:absolute;inset:-10px;border-radius:9999px;border:2px solid rgba(255,255,255,.15);animation:icPulse 2s ease-out infinite;}',
      '@keyframes icPulse{0%{transform:scale(.96);opacity:.8}70%{transform:scale(1.12);opacity:0}100%{opacity:0}}',
      '.ic-name{margin-top:1.5rem;font-size:1.9rem;font-weight:800;letter-spacing:-.02em;text-shadow:0 2px 20px rgba(0,0,0,.5);}',
      '.ic-sub{margin-top:.4rem;font-size:1rem;font-weight:600;color:rgba(255,255,255,.72);}',
      '.ic-dots{display:flex;gap:.35rem;margin-top:1rem;}',
      '.ic-dots span{width:.42rem;height:.42rem;border-radius:9999px;background:#fff;opacity:.3;animation:icDot 1.3s ease-in-out infinite;}',
      '.ic-dots span:nth-child(2){animation-delay:.18s}.ic-dots span:nth-child(3){animation-delay:.36s}',
      '@keyframes icDot{0%,100%{opacity:.25;transform:translateY(0)}50%{opacity:1;transform:translateY(-2px)}}',
      '.ic-actions{position:absolute;left:0;right:0;bottom:calc(2rem + env(safe-area-inset-bottom,0px));z-index:2;display:flex;flex-direction:column;gap:1rem;padding:0 2rem;}',
      '.ic-slide{position:relative;height:62px;border-radius:9999px;display:flex;align-items:center;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.14);overflow:hidden;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);}',
      '.ic-slide .ic-label{flex:1;text-align:center;font-size:.9rem;font-weight:700;letter-spacing:.01em;color:rgba(255,255,255,.78);pointer-events:none;}',
      '.ic-knob{position:absolute;top:6px;width:50px;height:50px;border-radius:9999px;display:flex;align-items:center;justify-content:center;font-size:19px;cursor:grab;touch-action:none;transition:transform .18s ease;box-shadow:0 6px 18px rgba(0,0,0,.35);}',
      '.ic-answer .ic-knob{left:6px;background:#34c759;color:#fff;}',
      '.ic-decline .ic-knob{right:6px;background:#ff3b30;color:#fff;}',
      '.ic-knob:active{cursor:grabbing;}',
      '.ic-slide.ic-armed .ic-label{opacity:0;}',
      '.ic-hint{margin-top:.75rem;font-size:.72rem;color:rgba(255,255,255,.42);text-align:center;}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function build() {
    if (root) return;
    injectStyles();
    root = document.createElement('div');
    root.className = 'ic-root';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.innerHTML = [
      '<div class="ic-bg" data-ic="bg"></div>',
      '<div class="ic-shade"></div>',
      '<div class="ic-content">',
      '  <div class="ic-avatar"><img data-ic="avatar" alt=""></div>',
      '  <div class="ic-name" data-ic="name"></div>',
      '  <div class="ic-sub" data-ic="sub">is calling you…</div>',
      '  <div class="ic-dots"><span></span><span></span><span></span></div>',
      '</div>',
      '<div class="ic-actions">',
      '  <div class="ic-slide ic-answer" data-ic="answer"><div class="ic-knob" data-ic="answerKnob"><i class="fa-solid fa-phone"></i></div><span class="ic-label">Slide to answer</span></div>',
      '  <div class="ic-slide ic-decline" data-ic="decline"><div class="ic-knob" data-ic="declineKnob"><i class="fa-solid fa-phone-slash"></i></div><span class="ic-label">Slide to decline</span></div>',
      '</div>',
      '<div class="ic-hint">Rings while the app is open</div>'
    ].join('');
    document.body.appendChild(root);

    els = {
      bg: root.querySelector('[data-ic="bg"]'),
      avatar: root.querySelector('[data-ic="avatar"]'),
      name: root.querySelector('[data-ic="name"]'),
      sub: root.querySelector('[data-ic="sub"]'),
      answer: root.querySelector('[data-ic="answer"]'),
      answerKnob: root.querySelector('[data-ic="answerKnob"]'),
      decline: root.querySelector('[data-ic="decline"]'),
      declineKnob: root.querySelector('[data-ic="declineKnob"]'),
    };

    wireSlide(els.answer, els.answerKnob, 1, function () {
      var a = active;
      hide();
      if (a && typeof a.onAccept === 'function') a.onAccept();
    });
    wireSlide(els.decline, els.declineKnob, -1, function () {
      var a = active;
      hide();
      if (a && typeof a.onDecline === 'function') a.onDecline();
    });
  }

  function wireSlide(rail, knob, direction, onComplete) {
    var dragging = false;
    var startX = 0;
    var offset = 0;
    var max = 0;

    function begin(e) {
      e.preventDefault();
      dragging = true;
      startX = e.clientX;
      offset = 0;
      max = rail.clientWidth - knob.offsetWidth - 12;
      knob.setPointerCapture && knob.setPointerCapture(e.pointerId);
      rail.classList.add('ic-armed');
    }
    function move(e) {
      if (!dragging) return;
      var dx = (e.clientX - startX) * direction;
      offset = Math.max(0, Math.min(max, dx));
      knob.style.transform = 'translateX(' + (offset * direction) + 'px)';
    }
    function end(e) {
      if (!dragging) return;
      dragging = false;
      rail.classList.remove('ic-armed');
      var pass = max > 0 && offset > max * 0.6;
      knob.style.transform = 'translateX(' + (pass ? max * direction : 0) + 'px)';
      if (!pass) setTimeout(function () { knob.style.transform = ''; }, 180);
      if (pass) setTimeout(onComplete, 120);
      if (e && e.pointerId != null && knob.releasePointerCapture) {
        try { knob.releasePointerCapture(e.pointerId); } catch (err) {}
      }
    }
    knob.addEventListener('pointerdown', begin);
    knob.addEventListener('pointermove', move);
    knob.addEventListener('pointerup', end);
    knob.addEventListener('pointercancel', end);
    // A simple tap also answers/declines after confirmation-ish double tap.
    var lastTap = 0;
    rail.addEventListener('click', function (e) {
      if (e.target.closest('.ic-knob')) return;
      var now = Date.now();
      if (now - lastTap < 350) { onComplete(); }
      lastTap = now;
    });
  }

  function show(opts) {
    build();
    active = opts || {};
    var character = active.character || {};
    var firstName = (character.name || 'Character').trim().split(/\s+/)[0] || 'Character';
    var feed = character.character_feeds && character.character_feeds.length ? character.character_feeds[0] : null;
    var bg = (feed && feed.media_url) || character.circular_profile_image_url || character.avatar || '';
    if (bg && bg.indexOf('undefined') === -1) els.bg.style.backgroundImage = 'url(' + bg + ')';
    var avatar = character.circular_profile_image_url || character.avatar || bg;
    if (avatar && avatar.indexOf('undefined') === -1) els.avatar.src = avatar;
    els.name.textContent = character.name || 'Character';
    els.sub.textContent = firstName + ' is calling you…';
    els.answerKnob.style.transform = '';
    els.declineKnob.style.transform = '';
    root.classList.add('open');
    document.body.style.overflow = 'hidden';
    try { if (navigator.vibrate) navigator.vibrate([400, 170, 400, 170, 400]); } catch (e) {}
  }

  function hide() {
    if (!root) return;
    root.classList.remove('open');
    document.body.style.overflow = '';
    active = null;
    try { if (navigator.vibrate) navigator.vibrate(0); } catch (e) {}
  }

  window.IncomingCallOverlay = {
    show: show,
    hide: hide,
    isOpen: function () { return !!(root && root.classList.contains('open')); },
  };
})();
