(function () {
  const { cleanText, dedupeProducts, extractFirstMoney, firstImage, firstLink, firstText, getPrice, truncate } = window.DomExtractor.helpers;

  function looksLikeProduct(element) {
    const text = cleanText(element.innerText || element.textContent);
    if (!text || text.length < 8) return false;

    const hasImage = Boolean(element.querySelector("img"));
    const hasLink = Boolean(element.querySelector("a[href]"));
    const hasName = Boolean(element.querySelector("[class*='productName' i], [class*='product-name' i], [class*='name' i], [itemprop='name'], a[title], h2, h3"));
    const hasPrice = Boolean(element.querySelector("[class*='sellingPrice' i], [class*='price' i], [itemprop='price']")) || Boolean(extractFirstMoney(text));

    return hasPrice && (hasName || (hasImage && hasLink));
  }

  function collectCandidates() {
    const selectors = [
      "[data-sku]",
      "[data-product-id]",
      "[data-testid*='product' i]",
      "[class*='product-summary' i]",
      "[class*='productSummary' i]",
      "[class*='product-card' i]",
      "[class*='productCard' i]",
      "[class*='product-item' i]",
      "[class*='productItem' i]",
      "[class*='product' i]",
      "article",
      "li",
      "div:has(img):has(a[href])"
    ];

    const candidates = new Set();

    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((element) => {
        if (looksLikeProduct(element)) {
          candidates.add(element);
        }
      });
    }

    return Array.from(candidates);
  }

  function getSku(container) {
    const attributes = ["data-sku", "data-product-id", "data-product-sku", "data-id", "data-sku-id"];

    for (const attr of attributes) {
      const value = cleanText(container.getAttribute(attr));
      if (value) return value;
    }

    const skuElement = container.querySelector("[data-sku], [data-product-id], [data-product-sku], [data-id], [data-sku-id]");
    if (skuElement) {
      for (const attr of attributes) {
        const value = cleanText(skuElement.getAttribute(attr));
        if (value) return value;
      }
    }

    const text = cleanText(container.innerText || container.textContent);
    const skuMatch = text.match(/\b(?:sku|codigo|c[oó]digo)\s*:?\s*([A-Za-z0-9_-]+)/i);
    if (skuMatch) return skuMatch[1];

    const link = firstLink(container);
    const fromUrl = link.match(/\/p\/([^/?#]+)/i) || link.match(/-([0-9]{4,})(?:[/?#]|$)/);
    return fromUrl ? fromUrl[1] : "";
  }

  function cleanPrice(value) {
    const text = cleanText(value);
    const money = text.match(/\$\s?[\d,.]+/);
    return money ? money[0] : text;
  }

  function priceFromContent(element) {
    const content = cleanText(element && element.getAttribute("content"));
    if (content) return content;

    return cleanPrice(element && (element.innerText || element.textContent));
  }

  function extractPrices(container) {
    const explicitPrice = priceFromContent(container.querySelector(".sales .value[content], span.sales .value[content]"));
    const explicitOldPrice = priceFromContent(container.querySelector(".price-before.strike-through .value[content], .price-before .value[content]"));

    const price = explicitPrice || cleanPrice(getPrice(container, [
      "[class*='sellingPrice' i]",
      "[class*='salePrice' i]",
      "[class*='bestPrice' i]",
      "[class*='price' i]",
      "[itemprop='price']"
    ]) || extractFirstMoney(container.innerText || container.textContent));

    const oldPrice = explicitOldPrice || cleanPrice(getPrice(container, [
      "[class*='listPrice' i]",
      "[class*='oldPrice' i]",
      "[class*='old-price' i]",
      "[class*='strike' i]",
      "s",
      "del"
    ]));

    return { price, oldPrice };
  }

  function extractProduct(container) {
    const name = firstText(container, [
      "[class*='productName' i]",
      "[class*='product-name' i]",
      "[class*='productTitle' i]",
      "[class*='product-title' i]",
      "[itemprop='name']",
      "a[title]",
      "h2",
      "h3",
      "a[href]"
    ]);

    const prices = extractPrices(container);

    const product = {
      name,
      price: prices.price,
      oldPrice: prices.oldPrice,
      image: firstImage(container),
      link: firstLink(container),
      sku: getSku(container),
      rawText: truncate(cleanText(container.innerText || container.textContent), 1000)
    };

    if (!product.name && !product.price && !product.link) {
      return null;
    }

    return product;
  }

  function extract() {
    const candidates = collectCandidates();
    const products = dedupeProducts(candidates.map(extractProduct).filter(Boolean));

    return {
      extractor: "farmaciasguadalajara",
      products,
      debug: {
        totalProductCandidates: candidates.length,
        totalProductsExtracted: products.length
      }
    };
  }

  window.DomExtractor.registerExtractor({
    id: "farmaciasguadalajara",
    domains: ["farmaciasguadalajara.com", "www.farmaciasguadalajara.com"],
    extract,
    collectCandidates
  });
})();
