/**
 * Yours plan gate for character-settings pages (conversation, voice,
 * relationship, personality). Applying any of these changes is a Pro feature:
 * free users are routed to the premium (Pro) page, Pro users run the callback.
 *
 * Usage (after the element the callback was attached from):
 *   YoursPlanGate.apply(function () { ...save + goBack... });
 */
(function () {
  function getCurrentUserId() {
    try {
      var u = window.YoursAPI && YoursAPI.getCurrentUser();
      return Promise.resolve(u && u.id ? u.id : null);
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  function goToPremium() {
    try {
      sessionStorage.setItem('yours_prev_page', window.location.pathname.split('/').pop() || 'character-profile.html');
      sessionStorage.setItem('yours_premium_flow', '1');
    } catch (e) {}
    window.location.href = 'premium-acess.html';
  }

  window.YoursPlanGate = {
    /**
     * Check the user's plan and either unlock the Pro action (callback) or
     * send a free user to the premium page.
     */
    apply: function (onPro) {
      getCurrentUserId().then(function (userId) {
        var gate = window.YoursAPI && window.YoursAPI.isPro
          ? window.YoursAPI.isPro(userId)
          : Promise.resolve(false);

        Promise.resolve(gate).then(function (pro) {
          if (pro) {
            if (typeof onPro === 'function') onPro();
            return;
          }
          goToPremium();
        }).catch(function () {
          goToPremium();
        });
      });
    },
  };
})();