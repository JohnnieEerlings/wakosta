/**
 * background.js – Service worker for WÅKOSTÅ
 *
 * Handles cross-origin fetch requests from the content script.
 * The content script cannot directly fetch from ikea.be / ikea.nl / ikea.de
 * while running on an ikea.com page due to CORS, so it sends a message here
 * and the service worker performs the fetch and returns the result.
 */

// Allowed hosts for price API fetches (must match the STORES in content.js).
const ALLOWED_HOSTS = new Set(["www.ikea.be", "www.ikea.nl", "www.ikea.de", "www.ikea.com"]);

/**
 * Validate that a URL targets one of the allowed IKEA store domains and
 * uses HTTPS. This prevents the service worker from being abused as a
 * general-purpose cross-origin proxy.
 */
function isAllowedUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    return parsed.protocol === "https:" && ALLOWED_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "WAKOSTA_FETCH") {
    return false;
  }

  const { url } = message;

  if (!isAllowedUrl(url)) {
    sendResponse({ ok: false, error: "URL not allowed" });
    return false;
  }

  fetch(url, {
    headers: {
      Accept: "text/html,application/json",
    },
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.text();
    })
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  // Return true to keep the message channel open for the async response.
  return true;
});
