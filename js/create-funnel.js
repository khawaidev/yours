/**
 * Yours — Create funnel shared helpers (desktop stages 1-5)
 * ------------------------------------------------------------
 * Persists funnel choices in sessionStorage under 'yours_create_prefs'
 * and powers the single-select chip groups used by every stage.
 *
 *   YoursCreate.prefs()            -> current saved choices (object)
 *   YoursCreate.save(patch)        -> merge keys into saved choices
 *   YoursCreate.bindChipGroups()   -> wire up [data-group] chip containers
 *   YoursCreate.collectGroups()    -> read every group's selected value
 */
(function () {
  'use strict';

  var KEY = 'yours_create_prefs';

  function prefs() {
    try {
      return JSON.parse(sessionStorage.getItem(KEY) || '{}') || {};
    } catch (e) {
      return {};
    }
  }

  function save(patch) {
    var p = prefs();
    Object.keys(patch || {}).forEach(function (k) { p[k] = patch[k]; });
    try { sessionStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* ignore */ }
    return p;
  }

  function bindChipGroups() {
    var savedPrefs = prefs();
    document.querySelectorAll('[data-group]').forEach(function (group) {
      var name = group.getAttribute('data-group');
      var selected = savedPrefs[name];
      var options = group.querySelectorAll('[data-value]');
      options.forEach(function (opt) {
        opt.addEventListener('click', function () {
          options.forEach(function (c) { c.classList.remove('is-selected'); });
          opt.classList.add('is-selected');
        });
        // Restore a previously saved choice.
        if (selected != null && opt.getAttribute('data-value') === String(selected)) {
          opt.classList.add('is-selected');
        }
      });
    });
  }

  function collectGroups() {
    var out = {};
    document.querySelectorAll('[data-group]').forEach(function (group) {
      var sel = group.querySelector('.is-selected[data-value]');
      if (sel) out[group.getAttribute('data-group')] = sel.getAttribute('data-value');
    });
    return out;
  }

  window.YoursCreate = {
    prefs: prefs,
    save: save,
    bindChipGroups: bindChipGroups,
    collectGroups: collectGroups
  };
})();
