/**
 * content.js – WÅKOSTÅ content script
 *
 * 1. Detects the IKEA product ID from the current URL (8-digit number).
 * 2. Fetches prices for Belgium (ikea.be), Netherlands (ikea.nl), and
 *    Germany (ikea.de) via the background service worker.
 * 3. Injects a floating price-comparison panel into the page.
 */

(function () {
  "use strict";

  // ── Constants ──────────────────────────────────────────────────────────────

  const PANEL_ID = "wakosta-panel";

  const STORES = [
    { id: "be", label: "🇧🇪 Belgium", currency: "€", domain: "www.ikea.com/be/nl" },
    { id: "nl", label: "🇳🇱 Netherlands", currency: "€", domain: "www.ikea.com/nl/nl" },
    { id: "de", label: "🇩🇪 Germany", currency: "€", domain: "www.ikea.com/de/de" },
  ];

  // IKEA's public pip (product information page) price API.
  // Returns JSON with a `regularPrice` and `currentPrice` field.
  function priceApiUrl(domain, productId) {
    return `https://${domain}/products/product-details/__pricemessage/${productId}/?returnUrl=%2F`;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Extract an 8-digit IKEA product number from the current URL.
   * IKEA URLs look like: /en/p/kallax-shelf-unit-white-10275861/
   * The product number is the trailing 8-digit segment.
   */
  function extractProductId() {
    const match = window.location.href.match(/(\d{8})(?:[/?#]|$)/);
    return match ? match[1] : null;
  }

  /**
   * Ask the background service worker to fetch a URL cross-origin.
   */
  function bgFetch(url) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "WAKOSTA_FETCH", url }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response && response.ok) {
          resolve(response.data);
        } else {
          reject(new Error(response ? response.error : "Unknown error"));
        }
      });
    });
  }

  /**
   * Parse the price value from IKEA's price API response.
   * The response format varies; we try several known field paths.
   */
  function parsePrice(data) {
    if (!data) return null;

    // Try top-level currentPrice / regularPrice objects
    const priceObj =
      data.currentPrice ||
      data.regularPrice ||
      (data.priceListPrice && data.priceListPrice[0]);

    if (priceObj) {
      const amount =
        priceObj.prefix != null
          ? `${priceObj.prefix}.${String(priceObj.suffix || "00").padStart(2, "0")}`
          : priceObj.price != null
          ? priceObj.price
          : null;
      if (amount != null) return String(amount);
    }

    // Fallback: stringify for debugging
    return null;
  }

  // ── UI ─────────────────────────────────────────────────────────────────────

  function createPanel() {
    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.setAttribute("role", "complementary");
    panel.setAttribute("aria-label", "WÅKOSTÅ price comparison");

    panel.innerHTML = `
      <div class="wakosta-header">
        <span class="wakosta-logo">WÅKOSTÅ</span>
        <button class="wakosta-close" aria-label="Close">&times;</button>
      </div>
      <div class="wakosta-body">
        <p class="wakosta-loading">Fetching prices…</p>
      </div>
    `;

    panel
      .querySelector(".wakosta-close")
      .addEventListener("click", () => panel.remove());

    document.body.appendChild(panel);
    return panel;
  }

  function renderTable(panel, rows) {
    const body = panel.querySelector(".wakosta-body");

    if (rows.every((r) => r.error)) {
      body.innerHTML = `<p class="wakosta-error">Could not fetch prices. Make sure you are on a product page.</p>`;
      return;
    }

    const tableRows = rows
      .map((row) => {
        if (row.error) {
          return `<tr>
            <td>${row.label}</td>
            <td colspan="2" class="wakosta-error-cell">N/A</td>
          </tr>`;
        }
        return `<tr>
          <td>${row.label}</td>
          <td class="wakosta-price">${row.currency}&nbsp;${row.price}</td>
          <td><a href="${row.productUrl}" target="_blank" rel="noopener noreferrer" class="wakosta-link">View</a></td>
        </tr>`;
      })
      .join("");

    body.innerHTML = `
      <table class="wakosta-table">
        <thead>
          <tr>
            <th>Store</th>
            <th>Price</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    `;
  }

  // ── Main ───────────────────────────────────────────────────────────────────

  async function run() {
    const productId = extractProductId();
    if (!productId) return; // Not a product page

    // Avoid injecting multiple panels
    if (document.getElementById(PANEL_ID)) return;

    const panel = createPanel();

    const results = await Promise.all(
      STORES.map(async (store) => {
        const apiUrl = priceApiUrl(store.domain, productId);
        const productUrl = `https://${store.domain}/products/${productId}/`;
        try {
          const data = await bgFetch(apiUrl);
          const price = parsePrice(data);
          if (!price) throw new Error("Price not found in response");
          return {
            label: store.label,
            currency: store.currency,
            price,
            productUrl,
          };
        } catch (err) {
          return {
            label: store.label,
            currency: store.currency,
            error: err.message,
            productUrl,
          };
        }
      })
    );

    renderTable(panel, results);
  }

  // ── Navigation detection ─────────────────────────────────────────────────

  /**
   * Re-run whenever the URL changes (IKEA is a SPA / uses History API).
   * We patch pushState/replaceState and also listen for popstate so that
   * both forward/back navigations and programmatic navigations are caught.
   * A MutationObserver is kept as a secondary fallback, but is throttled to
   * avoid excessive calls.
   */

  function handleNavigation() {
    const existing = document.getElementById(PANEL_ID);
    if (existing) existing.remove();
    run();
  }

  // Patch History API to emit a custom event on every navigation.
  function patchHistoryMethod(method) {
    const original = history[method];
    history[method] = function (...args) {
      const result = original.apply(this, args);
      window.dispatchEvent(new Event("wakosta:navigate"));
      return result;
    };
  }
  patchHistoryMethod("pushState");
  patchHistoryMethod("replaceState");

  window.addEventListener("popstate", handleNavigation);
  window.addEventListener("wakosta:navigate", handleNavigation);

  // Fallback MutationObserver – throttled so it fires at most once per second.
  let throttleTimer = null;
  let lastHref = window.location.href;
  const observer = new MutationObserver(() => {
    if (throttleTimer !== null) return;
    throttleTimer = setTimeout(() => {
      throttleTimer = null;
      if (window.location.href !== lastHref) {
        lastHref = window.location.href;
        handleNavigation();
      }
    }, 1000);
  });
  observer.observe(document.body, { childList: true, subtree: false });

  // Run on initial page load.
  run();
})();
