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

  const INLINE_PANEL_CLASS = "wakosta-inline-panel";

  const STORES = [
    { id: "be", label: "🇧🇪", currency: "€", domain: "www.ikea.com/be/nl" },
    { id: "nl", label: "🇳🇱", currency: "€", domain: "www.ikea.com/nl/nl" },
    { id: "de", label: "🇩🇪", currency: "€", domain: "www.ikea.com/de/de" },
  ];

  function productPageUrl(domain, productId) {
    return `https://${domain}/p/-${productId}/`;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function extractProductId(url) {
    const href = url || window.location.href;
    const match = href.match(/(\d{8})(?:[/?#]|$)/);
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
    if (!htmlStr) return null;

    // 1. Best: JSON-LD structured data – most reliable, canonical main product price
    const jsonLdBlocks = htmlStr.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
    for (const block of jsonLdBlocks) {
      try {
        const data = JSON.parse(block[1]);
        // Handle both single object and array of objects
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          const product = item['@type'] === 'Product' ? item : (item['@graph'] || []).find(n => n['@type'] === 'Product');
          if (product && product.offers) {
            const price = parseFloat(product.offers.price || product.offers.lowPrice);
            if (!isNaN(price) && price > 0) return price;
          }
        }
      } catch (e) { /* ignore malformed JSON */ }
    }

    // 2. itemprop price (Open Graph / microdata) – usually the canonical price too
    const itempropMatch = htmlStr.match(/<(?:meta|span)[^>]+itemprop="price"[^>]*content="([\d.]+)"/);
    if (itempropMatch) return parseFloat(itempropMatch[1]);

    // 3. IKEA pipcom-price (detail pages) – look for current-price context
    const currentPriceCtx = htmlStr.match(/pipcom-price-module__current-price[\s\S]{0,500}?pipcom-price__integer">(\d+)<\/span>[\s\S]{0,100}?pipcom-price__separator[^<]*<\/span>(\d+)<\/span>/);
    if (currentPriceCtx) return parseFloat(`${currentPriceCtx[1]}.${currentPriceCtx[2]}`);

    // 4. Broader pipcom-price fallback (first match)
    const pipcomMatch = htmlStr.match(/pipcom-price__integer">(\d+)<\/span>[\s\S]{0,100}?pipcom-price__separator[^<]*<\/span>(\d+)<\/span>/);
    if (pipcomMatch) return parseFloat(`${pipcomMatch[1]}.${pipcomMatch[2]}`);

    // 5. pip-temp-price (older IKEA page format)
    const pipTempMatch = htmlStr.match(/pip-temp-price__integer">(\d+)<\/span>[\s\S]{0,100}?pip-temp-price__separator[^<]*<\/span>(\d+)<\/span>/);
    if (pipTempMatch) return parseFloat(`${pipTempMatch[1]}.${pipTempMatch[2]}`);

    // 6. plp-price (list view format)
    const plpMatch = htmlStr.match(/plp-price__integer">(\d+)<\/span>[\s\S]{0,100}?plp-price__separator[^<]*<\/span>(\d+)<\/span>/);
    if (plpMatch) return parseFloat(`${plpMatch[1]}.${plpMatch[2]}`);

    return null;
  }

  // ── UI ─────────────────────────────────────────────────────────────────────

  function removeExistingPanels() {
    document.querySelectorAll(`.${INLINE_PANEL_CLASS}`).forEach(panel => panel.remove());
    document.querySelectorAll('.wakosta-price-icon').forEach(icon => icon.remove());
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

    // Place icon inside the energy-class wrapper (both pipcom- for detail pages and plp- for list pages)
    const ENERGY_CLASSES = [
      '.pipcom-price-module__primary-currency-price-energy-class',
      '.plp-price-module__primary-currency-price-energy-class',
    ];
    
    const energyWrapper = ENERGY_CLASSES.reduce(
      (found, sel) => found || container.querySelector(sel) || container.closest(sel),
      null
    ) || container;

    energyWrapper.appendChild(check);
  }

  async function fetchAndRenderPrices(productId, currentStoreId, priceContainer, isListView = false) {
    // Determine the current store object
    const currentStoreConfig = STORES.find(s => s.id === currentStoreId);
    if (!currentStoreConfig) return;

    // Build array of all store fetches
    // We fetch current store too, to get its parsed numeric price for comparison
    const fetchPromises = STORES.map(async (store) => {
      const url = productPageUrl(store.domain, productId);
      try {
        const html = await bgFetch(url);
        const price = parsePrice(html);
        return { ...store, price: price, productUrl: url, error: price === null };
      } catch (err) {
        return { ...store, price: null, productUrl: url, error: true };
      }
    });

    const results = await Promise.all(fetchPromises);
    
    // Guard against double-runs using a data attribute (not class, to avoid self-blocking)
    if (priceContainer.dataset.wakosta) {
      return;
    }
    priceContainer.dataset.wakosta = 'loading';

    const currentStore = results.find(r => r.id === currentStoreId);
    const otherStores = results.filter(r => r.id !== currentStoreId);

    // Create the inline panel
    const inlinePanel = document.createElement('div');
    inlinePanel.className = INLINE_PANEL_CLASS + (isListView ? ' wakosta-list-view' : '');
    
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
    priceContainer.dataset.wakosta = 'done';
    priceContainer.appendChild(inlinePanel);
  }

  // ── Main ───────────────────────────────────────────────────────────────────

  // Set to keep track of processed elements to avoid duplicate injections
  const processedItems = new Set();

  function processProductItem(itemEl, currentStoreId) {
    // Avoid double processing
    if (processedItems.has(itemEl)) return;
    
    // Try to get product ID from data attributes or href
    let productId = itemEl.getAttribute('data-product-number');
    
    if (!productId) {
      const link = itemEl.querySelector('a[href*="/p/"]');
      if (link) {
        productId = extractProductId(link.href);
      }
    }

    // List view items often have an "s" prefix for spr items (e.g. s89424468). Clean it up.
    if (productId && productId.startsWith('s')) {
       productId = productId.substring(1);
    }

    if (!productId || productId.length < 5) return; // Basic validation

    // Find the price container within this item (plp- prefix for list views)
    const priceContainer = itemEl.querySelector(
      '.plp-price-module__price, .plp-price-module__current-price, ' +
      '.pip-temp-price-package__main-price, .pip-price-module__price, ' +
      '.pipf-price-module, .pipcom-price-module__primary-currency-price, .pip-price-package'
    );
    
    if (priceContainer && !priceContainer.dataset.wakosta) {
      processedItems.add(itemEl);
      fetchAndRenderPrices(productId, currentStoreId, priceContainer, true /* isListView */);
    }
  }

  function processMainProductPage(currentStoreId) {
    const productId = extractProductId(window.location.href);
    if (!productId) return;

    // Try to find the energy-class wrapper first (ideal injection point for detail pages)
    const energyWrapper = document.querySelector('.pipcom-price-module__primary-currency-price-energy-class');
    const priceContainer = energyWrapper || document.querySelector(
      '.pip-temp-price-package__main-price, .pip-price-module__price, .pip-temp-price-module__price, .pipf-price-module, .pipf-price-package__price-module-wrapper, .pipcom-price-module__primary-currency-price'
    );
    
    if (priceContainer && !priceContainer.dataset.wakosta) {
      fetchAndRenderPrices(productId, currentStoreId, priceContainer);
    }
  }

  function run() {
    console.log("[Wakosta] Content script execution started.");
    const currentStoreId = getCurrentStoreId();
    if (!currentStoreId) {
      console.log("[Wakosta] Niet op een ondersteunde IKEA winkelpagina (.be, .nl, .de). Script stopt.");
      return;
    }

    // 1. Process main product page if we are on one
    processMainProductPage(currentStoreId);

    // 2. Process list view items continuously via MutationObserver
    // NOTE: Only use specific card-level classes – NOT [data-product-number] which
    // also matches color swatches and other sub-elements with wrong product IDs.
    const LIST_SELECTOR = '.plp-fragment-wrapper, .plp-product-compact, .pub__carousel-slide';

    const listObserver = new MutationObserver(() => {
      document.querySelectorAll(LIST_SELECTOR).forEach(item => processProductItem(item, currentStoreId));
      processMainProductPage(currentStoreId);
    });

    listObserver.observe(document.body, { childList: true, subtree: true });
    
    // Initial scan
    document.querySelectorAll(LIST_SELECTOR).forEach(item => processProductItem(item, currentStoreId));
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
