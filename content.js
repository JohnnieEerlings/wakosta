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

  const API_TIMEOUT = 5000;

  const INLINE_PANEL_ID = "wakosta-inline-panel";

  const STORES = [
    { id: "be", label: "🇧🇪", currency: "€", domain: "www.ikea.com/be/nl" },
    { id: "nl", label: "🇳🇱", currency: "€", domain: "www.ikea.com/nl/nl" },
    { id: "de", label: "🇩🇪", currency: "€", domain: "www.ikea.com/de/de" },
  ];

  function productPageUrl(domain, productId) {
    return `https://${domain}/p/-${productId}/`;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function extractProductId() {
    const match = window.location.href.match(/(\d{8})(?:[/?#]|$)/);
    return match ? match[1] : null;
  }

  function getCurrentStoreId() {
    const hostname = window.location.hostname;
    const pathname = window.location.pathname;
    
    if (hostname.includes('ikea.be') || (hostname.includes('ikea.com') && pathname.startsWith('/be/'))) return 'be';
    if (hostname.includes('ikea.nl') || (hostname.includes('ikea.com') && pathname.startsWith('/nl/'))) return 'nl';
    if (hostname.includes('ikea.de') || (hostname.includes('ikea.com') && pathname.startsWith('/de/'))) return 'de';
    
    return null;
  }

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

  function parsePrice(htmlStr) {
    const pipTempMatch = htmlStr.match(/<span class="pip-temp-price__integer">(\d+)<\/span>[^<]*<span class="pip-temp-price__decimal"><span class="pip-temp-price__separator">[^<]*<\/span>(\d+)<\/span>/);
    if (pipTempMatch) return parseFloat(`${pipTempMatch[1]}.${pipTempMatch[2]}`);

    const pipfMatch = htmlStr.match(/<span class="pipf-price__integer">(\d+)<\/span>[^<]*<span class="pipf-price__decimal"><span class="pipf-price__separator">[^<]*<\/span>(\d+)<\/span>/);
    if (pipfMatch) return parseFloat(`${pipfMatch[1]}.${pipfMatch[2]}`);

    const pipcomMatch = htmlStr.match(/<span class="pipcom-price__integer">(\d+)<\/span>[^<]*<span class="pipcom-price__decimal"><span class="pipcom-price__separator">[^<]*<\/span>(\d+)<\/span>/);
    if (pipcomMatch) return parseFloat(`${pipcomMatch[1]}.${pipcomMatch[2]}`);

    const fallbackMatch = htmlStr.match(/data-price="([^"]+)"/);
    if (fallbackMatch) return parseFloat(fallbackMatch[1]);

    const genericMatch = htmlStr.match(/content="(\d+\.\d+)"\s*itemprop="price"/);
    if (genericMatch) return parseFloat(genericMatch[1]);

    return null;
  }

  function waitForElement(selectors, timeout = 5000) {
    return new Promise((resolve) => {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) return resolve(el);
      }

      const observer = new MutationObserver((mutations, obs) => {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) {
            obs.disconnect();
            resolve(el);
            return;
          }
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  }

  // ── UI ─────────────────────────────────────────────────────────────────────

  function removeExistingPanels() {
    const existingFloating = document.getElementById('wakosta-panel'); // We didn't keep the constant here earlier, so just use string or add it back
    if (existingFloating) existingFloating.remove();
    
    const existingInline = document.getElementById(INLINE_PANEL_ID);
    if (existingInline) existingInline.remove();
  }

  function resetPriceColor(container) {
    const existingIcon = container.querySelector('.wakosta-price-icon');
    if (existingIcon) {
      existingIcon.remove();
    }
  }

  function appendPriceIcon(container, type) {
    // Prevent multiple icons
    if (container.querySelector('.wakosta-price-icon')) return;

    const check = document.createElement('span');
    check.className = 'wakosta-price-icon';
    
    // Custom SVGs based on the user's design
    const sadIconSVG = `<svg viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="50" fill="currentColor"/>
      <path d="M 50 15 L 72 35 L 72 82 C 72 86 68 90 64 90 L 36 90 C 32 90 28 86 28 82 L 28 35 Z" fill="white"/>
      <circle cx="50" cy="28" r="5" fill="currentColor"/>
      <path d="M 50 20 C 50 10 60 5 65 15" stroke="white" stroke-width="4" fill="none" stroke-linecap="round"/>
      <circle cx="50" cy="62" r="18" fill="none" stroke="currentColor" stroke-width="3"/>
      <path d="M 40 54 L 44 57 L 40 60 M 60 54 L 56 57 L 60 60" stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="none"/>
      <path d="M 43 71 Q 50 63 57 71" stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="none"/>
    </svg>`;

    const happyIconSVG = `<svg viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="50" fill="currentColor"/>
      <path d="M 50 15 L 72 35 L 72 82 C 72 86 68 90 64 90 L 36 90 C 32 90 28 86 28 82 L 28 35 Z" fill="white"/>
      <circle cx="50" cy="28" r="5" fill="currentColor"/>
      <path d="M 50 20 C 50 10 60 5 65 15" stroke="white" stroke-width="4" fill="none" stroke-linecap="round"/>
      <circle cx="50" cy="62" r="18" fill="none" stroke="currentColor" stroke-width="3"/>
      <path d="M 40 57 Q 42 53 44 57 M 56 57 Q 58 53 60 57" stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="none"/>
      <path d="M 43 65 Q 50 73 57 65" stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="none"/>
    </svg>`;

    if (type === 'best') {
      check.classList.add('wakosta-best-price');
      check.title = 'Beste prijs!';
      check.innerHTML = happyIconSVG;
    } else if (type === 'worse') {
      check.classList.add('wakosta-worse-price');
      check.title = 'Er is een betere prijs in het buitenland!';
      check.innerHTML = sadIconSVG;
    }

    // User requested to place the icon inside the `.pipcom-price-module__primary-currency-price-energy-class` wrapper
    const energyWrapper = container.querySelector('.pipcom-price-module__primary-currency-price-energy-class') || 
                          container.closest('.pipcom-price-module__primary-currency-price') || 
                          container;
    
    // If we found the specific wrapper, append there, else fallback
    if (energyWrapper.classList.contains('pipcom-price-module__primary-currency-price-energy-class')) {
      energyWrapper.appendChild(check);
    } else {
      container.appendChild(check);
    }
  }

  async function renderInline(productId, currentStoreId) {
    console.log("WAKOSTA: renderInline called for product", productId, "store", currentStoreId);
    const priceContainer = await waitForElement([
      '.pipcom-price-module__primary-currency-price',
      '.pip-price-package',
      '.pipf-price-module',
      '.pip-temp-price-module',
      '.pipf-price-package__price-module-wrapper',
      '.pip-temp-price-package'
    ]);

    if (!priceContainer) {
      console.log("WAKOSTA: Price container not found.");
      return;
    }
    console.log("WAKOSTA: Price container found.");

    if (document.getElementById(INLINE_PANEL_ID)) {
      console.log("WAKOSTA: Panel already exists, returning.");
      return;
    }
    
    // reset styling from previous runs if any
    resetPriceColor(priceContainer);

    const inlinePanel = document.createElement('div');
    inlinePanel.id = INLINE_PANEL_ID;
    inlinePanel.className = 'wakosta-inline-panel';
    inlinePanel.innerHTML = '<span class="wakosta-loading">Prijzen vergelijken…</span>';

    // Depending on the targeted container, we may need different styling.
    // If it's the more specific pipcom wrapper the user found, we might just append it.
    if (priceContainer.classList.contains('pipcom-price-module__primary-currency-price')) {
      priceContainer.style.display = 'flex';
      priceContainer.style.alignItems = 'center';
      priceContainer.style.flexWrap = 'wrap';
      priceContainer.style.gap = '12px';
    } else {
      // Fallback styling for the generic outer wrappers
      priceContainer.style.display = 'flex';
      priceContainer.style.alignItems = 'center';
      priceContainer.style.flexWrap = 'wrap';
      priceContainer.style.gap = '12px';
    }
    
    // Inject at the end of the container (after energy class if it exists)
    priceContainer.appendChild(inlinePanel);

    // Fetch prices asynchronously so it doesn't block UI interactions
    console.log("WAKOSTA: Triggering fetchAndRenderPrices...");
    fetchAndRenderPrices(productId, currentStoreId, inlinePanel, priceContainer);
  }
  
  async function fetchAndRenderPrices(productId, currentStoreId, inlinePanel, priceContainer) {
    const results = await Promise.all(
      STORES.map(async (store) => {
        const pageUrl = productPageUrl(store.domain, productId);
        try {
          const html = await bgFetch(pageUrl);
          const price = parsePrice(html);
          if (price === null) throw new Error("Price not found");
          return { ...store, price, productUrl: pageUrl };
        } catch (err) {
          return { ...store, error: err.message, productUrl: pageUrl };
        }
      })
    );

    const currentStore = results.find(r => r.id === currentStoreId);
    const otherStores = results.filter(r => r.id !== currentStoreId);

    // Clear loading text
    inlinePanel.innerHTML = '';
    
    otherStores.forEach(store => {
      const el = document.createElement('div');
      el.className = 'wakosta-inline-store';
      
      const flag = store.label;
      
      if (store.error) {
        el.innerHTML = `<span class="wakosta-flag" title="${store.id}">${flag}</span> <span class="wakosta-error">N/A</span>`;
      } else {
        const priceStr = store.price.toFixed(2).replace('.', ',');
        
        // Check if price is worse or better than current store
        let linkClass = 'wakosta-inline-link';
        if (currentStore && !currentStore.error) {
          if (store.price > currentStore.price) {
            linkClass += ' wakosta-negative-price';
          } else if (store.price < currentStore.price) {
            linkClass += ' wakosta-positive-price';
          }
        }
        
        el.innerHTML = `<a href="${store.productUrl}" target="_blank" class="${linkClass}" title="${store.id}">
          <span class="wakosta-flag">${flag}</span> <span class="wakosta-inline-price">${store.currency}${priceStr}</span>
        </a>`;
      }
      inlinePanel.appendChild(el);
    });

    // If current store is cheapest or equal, inject checkmark, else alert
    if (currentStore && !currentStore.error) {
      const isCheapest = otherStores.every(s => s.error || currentStore.price <= s.price);
      if (isCheapest) {
        appendPriceIcon(priceContainer, 'best');
      } else {
        appendPriceIcon(priceContainer, 'worse');
      }
    }
  }

  // ── Main ───────────────────────────────────────────────────────────────────

  async function run() {
    console.log("WAKOSTA: run() triggered on", window.location.href);
    const productId = extractProductId();
    if (!productId) {
      console.log("WAKOSTA: Not a product page, exiting.");
      return; 
    }

    const currentStoreId = getCurrentStoreId();
    console.log("WAKOSTA: Current store detected as:", currentStoreId);
    if (currentStoreId) {
      // Doesn't use await so that the observer initialization can continue and not stall
      renderInline(productId, currentStoreId);
    } else {
      console.log("WAKOSTA: Not a supported store domain.");
    }
  }

  // Expose run globally so background script can re-trigger on pushState navigations
  window.wakostaRun = run;

  // ── Navigation detection ─────────────────────────────────────────────────

  function handleNavigation() {
    removeExistingPanels();
    run();
  }

  // Patch History API
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
