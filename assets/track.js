// Fire-and-forget page-view beacon. Silent on any failure; never blocks the page.
(function () {
  try {
    var API = window.ANALYTICS_API;
    if (!API || API.indexOf("REPLACE-WITH") !== -1) return; // not configured yet
    var payload = JSON.stringify({ p: location.pathname, r: document.referrer || "" });
    var ok = false;
    if (navigator.sendBeacon) {
      // text/plain keeps it a CORS-simple request (no preflight)
      ok = navigator.sendBeacon(API + "/collect", new Blob([payload], { type: "text/plain" }));
    }
    if (!ok) {
      fetch(API + "/collect", { method: "POST", body: payload, keepalive: true, mode: "cors" });
    }
  } catch (e) { /* analytics must never break the site */ }
})();
