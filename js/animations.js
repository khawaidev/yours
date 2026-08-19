/**
 * Yours — shared entrance animations + optional per-page skeleton loader.
 *
 * Include right before </body> on any page:
 *   <script src="js/animations.js"></script>     (pages in frontend/)
 *   <script src="../js/animations.js"></script>  (pages in frontend/components/ or frontend/feedbacks/)
 *
 * Behavior:
 *  - Content always gets a staggered fade-slide-up reveal. Reveal targets are
 *    picked automatically: every direct child of <main>, plus the <header> and
 *    <footer> as single units, plus anything marked with data-reveal. Pages
 *    without <main> should mark their sections with data-reveal.
 *  - A skeleton loader only appears on pages that ship their own custom markup
 *    in a <div id="page-skeleton"> element (mirroring that page's layout).
 *    The shared script fades it out after ~1.1s and then plays the reveal.
 *  - Pages that already implement their own skeleton/reveal system (auth.html)
 *    are detected and skipped.
 */
(function () {
  if (window.__yoursSharedAnimations) return;
  window.__yoursSharedAnimations = true;

  // ---- Disable pinch-zoom / gesture zoom app-wide ----
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); }, { passive: false });
  document.addEventListener('gesturechange', function (e) { e.preventDefault(); }, { passive: false });
  document.addEventListener('gestureend', function (e) { e.preventDefault(); }, { passive: false });
  document.addEventListener('touchmove', function (e) {
    if (e.touches && e.touches.length > 1) e.preventDefault();
  }, { passive: false });
  document.documentElement.style.touchAction = 'manipulation';
  document.documentElement.style.overscrollBehavior = 'none';

  // Pages that already implement their own skeleton + reveal (auth.html) are skipped.
  if (document.getElementById('skeleton-screen')) return;

  // Respect reduced-motion preferences: show everything immediately.
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // ---- injected styles ----
  var css =
    '.skeleton-block{position:relative;overflow:hidden;background:#1c1b1b;border-radius:.75rem}' +
    '.skeleton-block::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.07),transparent);transform:translateX(-100%);animation:yshimmer 1.5s infinite}' +
    '@keyframes yshimmer{100%{transform:translateX(100%)}}' +
    '@keyframes yriseIn{from{opacity:0;transform:translateY(26px)}to{opacity:1;transform:translateY(0)}}' +
    '.reveal{opacity:0}' +
    '.reveal.in{animation:yriseIn .7s cubic-bezier(.22,1,.36,1) forwards;animation-delay:var(--d,0ms)}' +
    '#page-skeleton{position:fixed;inset:0;z-index:9999;background:#0e0e0e;transition:opacity .5s ease-out}';

  var style = document.createElement('style');
  style.setAttribute('data-purpose', 'shared-animations');
  style.textContent = css;
  document.head.appendChild(style);

  // ---- collect reveal targets ----
  function isContainerTag(el) {
    var tag = el.tagName;
    return tag !== 'SCRIPT' && tag !== 'STYLE' && tag !== 'TEMPLATE' && tag !== 'NOSCRIPT';
  }

  function collectTargets() {
    var targets = Array.prototype.slice.call(document.querySelectorAll('[data-reveal]'));

    var header = document.querySelector('header');
    if (header && isContainerTag(header) && targets.indexOf(header) === -1) targets.push(header);

    var main = document.querySelector('main');
    if (main) {
      Array.prototype.slice.call(main.children).forEach(function (el) {
        if (isContainerTag(el) && !el.classList.contains('reveal') && targets.indexOf(el) === -1) {
          targets.push(el);
        }
      });
    }

    var footer = document.querySelector('footer');
    if (footer && isContainerTag(footer) && targets.indexOf(footer) === -1) targets.push(footer);

    return targets;
  }

  var targets = collectTargets();

  // Hide content immediately (before first paint) so the reveal — with or
  // without a skeleton — never flashes.
  targets.forEach(function (el, i) {
    el.classList.add('reveal');
    el.style.setProperty('--d', Math.min(i * 70, 600) + 'ms');
  });

  // ---- optional per-page skeleton ----
  // Only pages that ship their own <div id="page-skeleton"> markup get a loader;
  // every other page reveals immediately.
  var skeleton = document.getElementById('page-skeleton');

  function run() {
    if (skeleton) {
      skeleton.style.opacity = '0';
      skeleton.style.pointerEvents = 'none';
      setTimeout(function () {
        if (skeleton.parentNode) skeleton.parentNode.removeChild(skeleton);
      }, 600);
    }
    targets.forEach(function (el) {
      el.classList.add('in');
    });
  }

  var delay = skeleton ? 1100 : 120;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(run, delay);
    });
  } else {
    setTimeout(run, delay);
  }
})();
