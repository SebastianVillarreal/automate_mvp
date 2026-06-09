(function () {
  const CAPTURE_API_URL = "http://localhost:3005/capture";
  const PENDING_SCRAPE_API_URL = "http://localhost:3005/pending-scrape";
  const AUTO_CAPTURE_FLAG = "__fahorroAutoCaptureStarted";

  function cleanText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function truncate(value, maxLength) {
    const text = value || "";
    return text.length > maxLength ? text.slice(0, maxLength) : text;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function absoluteUrl(value) {
    if (!value) return "";
    try {
      return new URL(value, window.location.href).href;
    } catch (_error) {
      return value;
    }
  }

  function firstText(container, selectors) {
    for (const selector of selectors) {
      const element = container.querySelector(selector);
      const text = cleanText(element && element.innerText);
      if (text) return text;

      const content = cleanText(element && element.getAttribute && element.getAttribute("content"));
      if (content) return content;

      const title = cleanText(element && element.getAttribute && element.getAttribute("title"));
      if (title) return title;
    }

    return "";
  }

  function getPrice(container, selectors) {
    for (const selector of selectors) {
      const element = container.querySelector(selector);
      if (!element) continue;

      const dataPrice = cleanText(element.getAttribute("data-price-amount"));
      if (dataPrice) return dataPrice;

      const content = cleanText(element.getAttribute("content"));
      if (content) return content;

      const text = cleanText(element.innerText || element.textContent);
      if (text) return text;
    }

    return "";
  }

  function getImage(container) {
    const img = container.querySelector("img");
    if (!img) return "";

    return absoluteUrl(
      img.getAttribute("src") ||
      img.getAttribute("data-src") ||
      img.getAttribute("data-original") ||
      img.getAttribute("data-lazy")
    );
  }

  function getLink(container) {
    const link = container.querySelector("a[href]");
    return link ? absoluteUrl(link.getAttribute("href")) : "";
  }

  function getSku(container) {
    const attributes = [
      "data-product-sku",
      "data-sku",
      "data-product-id",
      "data-id",
      "data-product"
    ];

    const addToCartForm = container.querySelector("form[data-role='tocart-form'][data-product-sku]");
    const addToCartSku = cleanText(addToCartForm && addToCartForm.getAttribute("data-product-sku"));
    if (addToCartSku) return addToCartSku;

    for (const attr of attributes) {
      const value = cleanText(container.getAttribute(attr));
      if (value) return value;
    }

    const skuElement = container.querySelector("[data-product-sku], [data-sku], [data-product-id], [data-id]");
    if (skuElement) {
      for (const attr of attributes) {
        const value = cleanText(skuElement.getAttribute(attr));
        if (value) return value;
      }
    }

    return "";
  }

  function looksLikeProductCard(element) {
    const text = cleanText(element.innerText);
    if (!text || text.length < 8) return false;

    const hasName = Boolean(element.querySelector(".product-item-name, .product-name, [itemprop='name'], a[title], h2, h3"));
    const hasPrice = Boolean(element.querySelector(".price, .special-price, [data-price-amount], [itemprop='price']"));
    const hasImageOrLink = Boolean(element.querySelector("img, a[href]"));
    const textHasPrice = /(\$|MXN|MN)\s?\d|(?:\d+[.,]\d{2})/.test(text);

    return (hasName && (hasPrice || textHasPrice)) || (hasPrice && hasImageOrLink);
  }

  function collectProductCandidates() {
    const selectorGroups = [
      "[class*='product' i]",
      "[data-product-id]",
      "[data-product-sku]",
      "[data-sku]",
      "[itemtype*='Product' i]",
      "li",
      "article",
      ".card",
      "[class*='card' i]"
    ];

    const candidates = new Set();

    for (const selector of selectorGroups) {
      document.querySelectorAll(selector).forEach((element) => {
        if (looksLikeProductCard(element)) {
          candidates.add(element);
        }
      });
    }

    return Array.from(candidates);
  }

  function extractProduct(container) {
    const name = firstText(container, [
      ".product-item-name",
      ".product-name",
      "[itemprop='name']",
      "a[title]",
      "h2",
      "h3"
    ]);

    const price = getPrice(container, [
      ".special-price .price",
      ".price",
      ".special-price",
      "[data-price-amount]",
      "[itemprop='price']"
    ]);

    const oldPrice = getPrice(container, [
      ".old-price .price",
      ".old-price",
      ".was-price",
      ".price-old"
    ]);

    const product = {
      name,
      price,
      oldPrice,
      image: getImage(container),
      link: getLink(container),
      sku: getSku(container),
      rawText: truncate(cleanText(container.innerText), 1000)
    };

    if (!product.name && !product.price && !product.link) {
      return null;
    }

    return product;
  }

  function dedupeProducts(products) {
    const seenLinks = new Set();
    const seenNamePrice = new Set();
    const unique = [];

    for (const product of products) {
      const linkKey = product.link && product.link.toLowerCase();
      const namePriceKey = `${product.name.toLowerCase()}|${product.price.toLowerCase()}`;

      if (linkKey && seenLinks.has(linkKey)) continue;
      if (!linkKey && product.name && product.price && seenNamePrice.has(namePriceKey)) continue;

      if (linkKey) seenLinks.add(linkKey);
      if (product.name && product.price) seenNamePrice.add(namePriceKey);

      unique.push(product);
    }

    return unique;
  }

  function extractPageData() {
    const candidates = collectProductCandidates();
    const products = dedupeProducts(candidates.map(extractProduct).filter(Boolean));

    return {
      url: window.location.href,
      title: document.title,
      timestamp: new Date().toISOString(),
      text: document.body ? document.body.innerText : "",
      html: document.documentElement ? document.documentElement.outerHTML : "",
      products,
      debug: {
        totalProductCandidates: candidates.length,
        totalProductsExtracted: products.length
      }
    };
  }

  async function captureCurrentPage(extraFields = {}) {
    const data = {
      ...extractPageData(),
      ...extraFields
    };

    const response = await fetch(CAPTURE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(data)
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.error || `Capture failed with HTTP ${response.status}`);
    }

    return result;
  }

  async function waitForProductCandidates(maxWaitMs) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < maxWaitMs) {
      if (collectProductCandidates().length > 0) {
        return true;
      }

      await sleep(1000);
    }

    return false;
  }

  async function getPendingScrape() {
    const url = `${PENDING_SCRAPE_API_URL}?url=${encodeURIComponent(window.location.href)}`;
    const response = await fetch(url);

    if (!response.ok) {
      return null;
    }

    return response.json();
  }

  async function autoCapturePendingScrape() {
    if (window[AUTO_CAPTURE_FLAG]) {
      return;
    }

    window[AUTO_CAPTURE_FLAG] = true;

    try {
      await sleep(1500);

      const pending = await getPendingScrape();
      if (!pending || !pending.pending || !pending.job) {
        return;
      }

      console.log("Pending scrape job found:", pending.job);

      await sleep(pending.job.waitBeforeCaptureMs || 4000);
      await waitForProductCandidates(15000);

      const result = await captureCurrentPage({
        jobId: pending.job.id,
        captureMode: "auto"
      });

      console.log("Automatic capture saved:", result);
    } catch (error) {
      console.warn("Automatic capture did not run:", error.message);
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.action !== "extract") {
      return false;
    }

    captureCurrentPage()
      .then((result) => {
        console.log("Capture saved:", result);
        sendResponse({ ok: true, result });
      })
      .catch((error) => {
        console.error("Capture failed:", error);
        sendResponse({ ok: false, error: error.message });
      });

    return true;
  });

  window.extractPageData = extractPageData;
  autoCapturePendingScrape();
})();
