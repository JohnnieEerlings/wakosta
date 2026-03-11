/**
 * background.js – Service worker for WÅKOSTÅ
 *
 * Handles cross-origin fetch requests from the content script.
 * The content script cannot directly fetch ikea.be / ikea.nl / ikea.de
 * from an ikea.com page due to CORS, so it sends a message here and
 * the service worker performs the fetch and returns the result.
 */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "WAKOSTA_FETCH") {
    return false;
  }

  const { url } = message;

  fetch(url, {
    headers: {
      Accept: "application/json",
    },
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    })
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  // Return true to keep the message channel open for the async response.
  return true;
});
