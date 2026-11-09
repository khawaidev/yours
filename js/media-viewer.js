/**
 * Full-screen media viewer used by chat, the Photos modal and the character
 * profile. Works with local Blob URLs (original quality, never a thumbnail).
 *
 * Features: wheel zoom, pinch zoom, drag pan, double-click/double-tap zoom,
 * zoom in/out, reset, download, close (X / Escape), prev/next navigation
 * (buttons, arrow keys, swipe), original-quality media.
 */
(function () {
  var STYLE_ID = 'mv-styles';
  var root = null;
  var els = null;
  var state = {
    items: [],
    index: 0,
    scale: 1,
    tx: 0,
    ty: 0,
    minScale: 1,
    maxScale: 8,
    dragging: false,
    dragStart: null,
    pinch: null,
    pointers: {},
    onClose: null,
    lastTap: 0,
  };

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.mv-root{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.96);display:none;flex-direction:column;align-items:center;justify-content:center;touch-action:none;user-select:none;-webkit-user-select:none;overscroll-behavior:contain;}',
      '.mv-root.open{display:flex;}',
      '.mv-stage{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:grab;}',
      '.mv-stage.mv-dragging{cursor:grabbing;}',
      '.mv-stage.mv-zoomed{cursor:grab;}',
      '.mv-media{max-width:100vw;max-height:100vh;width:auto;height:auto;object-fit:contain;transform-origin:center center;will-change:transform;pointer-events:auto;background:#000;touch-action:none;}',
      '.mv-media.mv-video{max-width:94vw;max-height:82vh;pointer-events:auto;}',
      '.mv-top{position:absolute;top:0;left:0;right:0;display:flex;align-items:center;justify-content:space-between;padding:calc(.75rem + env(safe-area-inset-top,0px)) 1rem .75rem;z-index:4;background:linear-gradient(to bottom,rgba(0,0,0,.65),transparent);}',
      '.mv-count{color:rgba(255,255,255,.85);font:600 13px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:rgba(0,0,0,.45);padding:.45rem .75rem;border-radius:9999px;}',
      '.mv-icon-btn{width:42px;height:42px;border-radius:9999px;border:0;background:rgba(0,0,0,.5);color:#fff;display:flex;align-items:center;justify-content:center;font-size:18px;cursor:pointer;transition:background .15s,transform .1s;}',
      '.mv-icon-btn:hover{background:rgba(255,255,255,.18);}',
      '.mv-icon-btn:active{transform:scale(.94);}',
      '.mv-tools{position:absolute;bottom:0;left:0;right:0;display:flex;align-items:center;justify-content:center;gap:.5rem;padding:1rem 1rem calc(1rem + env(safe-area-inset-bottom,0px));z-index:4;background:linear-gradient(to top,rgba(0,0,0,.7),transparent);}',
      '.mv-nav{position:absolute;top:50%;transform:translateY(-50%);z-index:4;}',
      '.mv-prev{left:.75rem;} .mv-next{right:.75rem;}',
      '.mv-nav[disabled]{opacity:.25;pointer-events:none;}',
      '.mv-zoom-label{min-width:56px;text-align:center;color:#fff;font:600 13px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;opacity:.85;}',
      '.mv-hint{position:absolute;bottom:7.5rem;left:50%;transform:translateX(-50%);color:rgba(255,255,255,.55);font:500 12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-align:center;pointer-events:none;transition:opacity .4s;z-index:3;}',
      '.mv-error{color:#fff;text-align:center;padding:2rem;font:500 15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}',
      '@media (max-width:640px){.mv-icon-btn{width:38px;height:38px;font-size:16px;} .mv-hint{bottom:6.2rem;}}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function build() {
    if (root) return;
    injectStyles();
    root = document.createElement('div');
    root.className = 'mv-root';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Media viewer');
    root.innerHTML = [
      '<div class="mv-top">',
      '  <button class="mv-icon-btn" data-mv="close" type="button" aria-label="Close viewer"><i class="fa-solid fa-xmark"></i></button>',
      '  <div class="mv-count" data-mv="count"></div>',
      '  <button class="mv-icon-btn" data-mv="download" type="button" aria-label="Download"><i class="fa-solid fa-download"></i></button>',
      '</div>',
      '<div class="mv-stage" data-mv="stage">',
      '  <button class="mv-icon-btn mv-nav mv-prev" data-mv="prev" type="button" aria-label="Previous"><i class="fa-solid fa-chevron-left"></i></button>',
      '  <button class="mv-icon-btn mv-nav mv-next" data-mv="next" type="button" aria-label="Next"><i class="fa-solid fa-chevron-right"></i></button>',
      '</div>',
      '<div class="mv-hint" data-mv="hint">Scroll or pinch to zoom · drag to pan · double-tap to zoom</div>',
      '<div class="mv-tools">',
      '  <button class="mv-icon-btn" data-mv="zoomout" type="button" aria-label="Zoom out"><i class="fa-solid fa-magnifying-glass-minus"></i></button>',
      '  <div class="mv-zoom-label" data-mv="zoomlabel">100%</div>',
      '  <button class="mv-icon-btn" data-mv="zoomin" type="button" aria-label="Zoom in"><i class="fa-solid fa-magnifying-glass-plus"></i></button>',
      '  <button class="mv-icon-btn" data-mv="reset" type="button" aria-label="Reset zoom"><i class="fa-solid fa-rotate-left"></i></button>',
      '</div>'
    ].join('');
    document.body.appendChild(root);

    els = {
      stage: root.querySelector('[data-mv="stage"]'),
      count: root.querySelector('[data-mv="count"]'),
      hint: root.querySelector('[data-mv="hint"]'),
      zoomLabel: root.querySelector('[data-mv="zoomlabel"]'),
      prev: root.querySelector('[data-mv="prev"]'),
      next: root.querySelector('[data-mv="next"]'),
      close: root.querySelector('[data-mv="close"]'),
      download: root.querySelector('[data-mv="download"]'),
      zoomin: root.querySelector('[data-mv="zoomin"]'),
      zoomout: root.querySelector('[data-mv="zoomout"]'),
      reset: root.querySelector('[data-mv="reset"]'),
    };

    els.close.addEventListener('click', close);
    els.download.addEventListener('click', downloadCurrent);
    els.prev.addEventListener('click', function () { navigate(-1); });
    els.next.addEventListener('click', function () { navigate(1); });
    els.zoomin.addEventListener('click', function () { zoomBy(0.5); });
    els.zoomout.addEventListener('click', function () { zoomBy(-0.35); });
    els.reset.addEventListener('click', resetZoom);
    root.addEventListener('click', function (e) {
      // A drag that panned the image must not be treated as a background tap.
      if (state.moved) { state.moved = false; return; }
      if (e.target === root || e.target === els.stage) close();
    });

    // Wheel zoom (desktop)
    els.stage.addEventListener('wheel', function (e) {
      if (!state.items[state.index] || state.items[state.index].kind === 'video') return;
      e.preventDefault();
      var factor = Math.exp(-e.deltaY * 0.0015);
      zoomAt(state.scale * factor, e.clientX, e.clientY);
    }, { passive: false });

    // Pointer events: pan (1 pointer), pinch (2 pointers)
    els.stage.addEventListener('pointerdown', onPointerDown);
    els.stage.addEventListener('pointermove', onPointerMove);
    els.stage.addEventListener('pointerup', onPointerUp);
    els.stage.addEventListener('pointercancel', onPointerUp);

    // Double click / double tap
    els.stage.addEventListener('click', function (e) {
      var item = state.items[state.index];
      if (!item || item.kind === 'video') return;
      if (e.target.closest('button')) return;
      var now = Date.now();
      if (now - state.lastTap < 300) {
        if (state.scale > 1.01) resetZoom();
        else zoomAt(2.5, e.clientX, e.clientY);
        state.lastTap = 0;
      } else {
        state.lastTap = now;
      }
    });

    document.addEventListener('keydown', onKeyDown);
  }

  function current() { return state.items[state.index] || null; }

  function render() {
    if (!els) return;
    var item = current();
    els.stage.querySelectorAll('.mv-media, .mv-error').forEach(function (n) { n.remove(); });
    resetState();
    if (!item) return;
    if (item.kind === 'video') {
      var vid = document.createElement('video');
      vid.className = 'mv-media mv-video';
      vid.src = item.url;
      vid.controls = true;
      vid.autoplay = true;
      vid.playsInline = true;
      vid.addEventListener('error', function () { showError(); });
      els.stage.appendChild(vid);
      els.hint.textContent = 'Tap play · use the controls to seek';
    } else {
      var img = document.createElement('img');
      img.className = 'mv-media';
      img.alt = item.alt || 'Media';
      img.src = item.url;
      img.draggable = false;
      img.addEventListener('load', function () { fitImage(img); });
      img.addEventListener('error', function () { showError(); });
      els.stage.appendChild(img);
      if (img.complete && img.naturalWidth) fitImage(img);
      els.hint.textContent = 'Scroll or pinch to zoom · drag to pan · double-tap to zoom';
    }
    els.count.textContent = state.items.length > 1 ? (state.index + 1) + ' / ' + state.items.length : '';
    els.prev.disabled = state.index <= 0;
    els.next.disabled = state.index >= state.items.length - 1;
    els.zoomLabel.textContent = '100%';
    // Fade the hint after a few seconds.
    els.hint.style.opacity = '';
    clearTimeout(render._hintTimer);
    render._hintTimer = setTimeout(function () { if (els) els.hint.style.opacity = '0'; }, 3500);
  }

  function fitImage(img) {
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var ivw = img.naturalWidth || img.width || vw;
    var ivh = img.naturalHeight || img.height || vh;
    var fit = Math.min(vw / ivw, vh / ivh, 1);
    img.style.width = Math.round(ivw * fit) + 'px';
    img.style.height = Math.round(ivh * fit) + 'px';
    applyTransform();
  }

  function resetState() {
    state.scale = 1;
    state.tx = 0;
    state.ty = 0;
    state.dragging = false;
    state.pinch = null;
    state.pointers = {};
    applyTransform();
  }

  function applyTransform() {
    var media = els && els.stage.querySelector('.mv-media');
    if (!media || media.classList.contains('mv-video')) return;
    media.style.transform = 'translate(' + state.tx + 'px,' + state.ty + 'px) scale(' + state.scale + ')';
    els.stage.classList.toggle('mv-zoomed', state.scale > 1.01);
    els.zoomLabel.textContent = Math.round(state.scale * 100) + '%';
  }

  function clampPan() {
    var media = els.stage.querySelector('.mv-media');
    if (!media) return;
    // offsetWidth/Height are the untransformed layout size (fitImage sets them).
    var w = media.offsetWidth || media.naturalWidth || window.innerWidth;
    var h = media.offsetHeight || media.naturalHeight || window.innerHeight;
    var maxX = Math.max(0, (w * state.scale - window.innerWidth) / 2);
    var maxY = Math.max(0, (h * state.scale - window.innerHeight) / 2);
    state.tx = Math.max(-maxX, Math.min(maxX, state.tx));
    state.ty = Math.max(-maxY, Math.min(maxY, state.ty));
  }

  function zoomAt(targetScale, clientX, clientY) {
    var media = els.stage.querySelector('.mv-media');
    if (!media || media.classList.contains('mv-video')) return;
    var prev = state.scale;
    var next = Math.max(state.minScale, Math.min(state.maxScale, targetScale));
    if (Math.abs(next - prev) < 0.001) return;

    // Keep the point under the cursor/fingers stationary (transform-origin is
    // the image centre, so the visual centre is rect centre + translation).
    var rect = media.getBoundingClientRect();
    var cx = clientX == null ? rect.left + rect.width / 2 : clientX;
    var cy = clientY == null ? rect.top + rect.height / 2 : clientY;
    var visualCx = rect.left + rect.width / 2;
    var visualCy = rect.top + rect.height / 2;
    var ratio = next / prev;
    state.tx += (cx - visualCx) * (1 - ratio);
    state.ty += (cy - visualCy) * (1 - ratio);
    state.scale = next;
    if (state.scale <= 1.01) {
      state.scale = 1;
      state.tx = 0;
      state.ty = 0;
    } else {
      clampPan();
    }
    applyTransform();
  }

  function zoomBy(delta) {
    var media = els.stage.querySelector('.mv-media');
    if (!media) return;
    var rect = media.getBoundingClientRect();
    zoomAt(state.scale + delta, rect.left + rect.width / 2, rect.top + rect.height / 2);
    clampPan();
    applyTransform();
  }

  function resetZoom() {
    var media = els.stage.querySelector('.mv-media');
    if (media) {
      // Re-fit in case the viewport changed (rotation / resize).
      if (!media.classList.contains('mv-video')) fitImage(media);
    }
    state.scale = 1; state.tx = 0; state.ty = 0;
    applyTransform();
  }

  function onPointerDown(e) {
    var item = current();
    if (!item || item.kind === 'video') return;
    if (e.target.closest('button')) return;
    state.pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    try { els.stage.setPointerCapture(e.pointerId); } catch (err) {}
    var keys = Object.keys(state.pointers);
    if (keys.length === 1) {
      state.dragging = true;
      state.moved = false;
      state.dragStart = { x: e.clientX - state.tx, y: e.clientY - state.ty };
      state.down = { x: e.clientX, y: e.clientY, t: Date.now() };
      els.stage.classList.add('mv-dragging');
    } else if (keys.length === 2) {
      state.dragging = false;
      var pts = keys.map(function (k) { return state.pointers[k]; });
      state.pinch = {
        dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        scale: state.scale,
        cx: (pts[0].x + pts[1].x) / 2,
        cy: (pts[0].y + pts[1].y) / 2,
      };
    }
  }

  function onPointerMove(e) {
    var item = current();
    if (!item || item.kind === 'video') return;
    if (!state.pointers[e.pointerId]) return;
    state.pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    if (state.down && Math.hypot(e.clientX - state.down.x, e.clientY - state.down.y) > 6) state.moved = true;
    var keys = Object.keys(state.pointers);
    if (keys.length >= 2 && state.pinch) {
      var pts = keys.map(function (k) { return state.pointers[k]; });
      var dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (state.pinch.dist > 0) {
        var target = state.pinch.scale * (dist / state.pinch.dist);
        zoomAt(target, state.pinch.cx, state.pinch.cy);
      }
      return;
    }
    if (state.dragging && state.dragStart && state.scale > 1.01) {
      state.tx = e.clientX - state.dragStart.x;
      state.ty = e.clientY - state.dragStart.y;
      clampPan();
      applyTransform();
    }
  }

  function onPointerUp(e) {
    var had = state.pointers[e.pointerId];
    if (!had) return;
    try { els.stage.releasePointerCapture(e.pointerId); } catch (err) {}
    delete state.pointers[e.pointerId];
    var keys = Object.keys(state.pointers);
    if (keys.length === 0) {
      state.dragging = false;
      state.dragStart = null;
      state.pinch = null;
      els.stage.classList.remove('mv-dragging');
      if (state.scale <= 1.01) { state.tx = 0; state.ty = 0; applyTransform(); }
      // Horizontal swipe navigates when not zoomed.
      if (state.scale <= 1.01 && state.down) {
        var sdx = e.clientX - state.down.x;
        var sdy = e.clientY - state.down.y;
        if (Date.now() - state.down.t < 600 && Math.abs(sdx) > 70 && Math.abs(sdx) > Math.abs(sdy) * 1.5) {
          navigate(sdx > 0 ? -1 : 1);
        }
      }
      state.down = null;
    } else if (keys.length === 1) {
      var p = state.pointers[keys[0]];
      state.dragStart = { x: p.x - state.tx, y: p.y - state.ty };
      state.pinch = null;
      state.dragging = true;
    }
  }

  function onKeyDown(e) {
    if (!root || !root.classList.contains('open')) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); navigate(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); navigate(1); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(0.5); }
    else if (e.key === '-') { e.preventDefault(); zoomBy(-0.35); }
    else if (e.key === '0') { e.preventDefault(); resetZoom(); }
  }

  function navigate(dir) {
    var next = state.index + dir;
    if (next < 0 || next >= state.items.length) return;
    state.index = next;
    render();
  }

  function downloadCurrent() {
    var item = current();
    if (!item || !item.url) return;
    var name = item.fileName || ('yours-media-' + (state.index + 1) + (item.kind === 'video' ? '.mp4' : (item.kind === 'voice' ? '.mp3' : '.jpg')));
    try {
      var a = document.createElement('a');
      a.href = item.url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { a.remove(); }, 0);
      return;
    } catch (e) {}
    // Fallback for cross-origin URLs: fetch → Blob → download.
    fetch(item.url).then(function (r) { return r.blob(); }).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
    }).catch(function () {
      window.open(item.url, '_blank', 'noopener');
    });
  }

  function showError() {
    if (!els) return;
    els.stage.querySelectorAll('.mv-media').forEach(function (n) { n.remove(); });
    var msg = document.createElement('div');
    msg.className = 'mv-error';
    msg.textContent = 'This media could not be loaded. It may have been removed from this device.';
    els.stage.appendChild(msg);
  }

  function open(options) {
    build();
    state.items = (options && options.items) || [];
    state.index = Math.max(0, Math.min(state.items.length - 1, (options && options.index) || 0));
    state.onClose = options && options.onClose;
    if (!state.items.length) return;
    // Clear any leftover gesture flags from a previous session so the first
    // tap behaves normally (navigate() deliberately does not clear `moved`).
    state.moved = false;
    state.down = null;
    state.lastTap = 0;
    resetState();
    render();
    root.classList.add('open');
    document.body.style.overflow = 'hidden';
    // Move focus to the close button for keyboard users.
    setTimeout(function () { try { els.close.focus(); } catch (e) {} }, 0);
  }

  function close() {
    if (!root) return;
    root.classList.remove('open');
    document.body.style.overflow = '';
    els.stage.querySelectorAll('video').forEach(function (v) { try { v.pause(); } catch (e) {} });
    els.stage.querySelectorAll('.mv-media, .mv-error').forEach(function (n) { n.remove(); });
    var cb = state.onClose;
    state.items = [];
    state.onClose = null;
    if (typeof cb === 'function') { try { cb(); } catch (e) {} }
  }

  window.addEventListener('resize', function () {
    if (!root || !root.classList.contains('open')) return;
    resetZoom();
  });

  window.MediaViewer = { open: open, close: close };
})();
