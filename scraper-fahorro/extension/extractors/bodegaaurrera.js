(function () {
  const { cleanText, dedupeProducts, extractFirstMoney, firstImage, firstLink, firstText, getPrice, truncate } = window.DomExtractor.helpers;

  function looksLikeBodegaProduct(element) {
    const text = cleanText(element.innerText);
    if (!text || text.length < 8) return false;

    const hasProductLink = Boolean(element.querySelector("a[href*='/ip/'], a[href*='/producto/'], a[href*='/p/']"));
    const hasName = Boolean(element.querySelector("[data-automation-id*='product-title' i], [data-testid*='product-title' i], [aria-label], a[href]"));
    const hasPrice = Boolean(element.querySelector("[data-automation-id*='price' i], [data-testid*='price' i], [itemprop='price']")) || Boolean(extractFirstMoney(text));

    return hasPrice && (hasProductLink || hasName);
  }

  function collectCandidates() {
    const selectors = [
      "[data-automation-id*='product' i]",
      "[data-testid*='product' i]",
      "[data-testid*='item' i]",
      "[class*='product' i]",
      "[class*='tile' i]",
      "div:has(a[href*='/ip/'])",
      "li:has(a[href*='/ip/'])",
      "article",
      "li"
    ];

    const candidates = new Set();

    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((element) => {
        if (looksLikeBodegaProduct(element)) {
          candidates.add(element);
        }
      });
    }

    return Array.from(candidates);
  }

  function getSku(container) {
    const link = firstLink(container);
    const match = link.match(/\/ip\/(?:[^/]+\/)?(\d+)(?:[/?#]|$)/i);
    if (match) return match[1];

    const attributes = ["data-item-id", "data-product-id", "data-sku", "data-us-item-id", "data-id"];
    for (const attr of attributes) {
      const value = cleanText(container.getAttribute(attr));
      if (value) return value;
    }

    const skuElement = container.querySelector("[data-item-id], [data-product-id], [data-sku], [data-us-item-id], [data-id]");
    if (skuElement) {
      for (const attr of attributes) {
        const value = cleanText(skuElement.getAttribute(attr));
        if (value) return value;
      }
    }

    return "";
  }

  function extractMoneyValues(text) {
    return cleanText(text).match(/\$\s?[\d,.]+/g) || [];
  }

  function extractBodegaPrices(container) {
    const priceContainer = container.querySelector("[data-automation-id='product-price']");
    if (!priceContainer) {
      return {
        price: getPrice(container, [
          "[data-automation-id*='product-price' i]",
          "[data-automation-id*='price' i]",
          "[data-testid*='price' i]",
          "[itemprop='price']",
          "[aria-label*='$']"
        ]) || extractFirstMoney(container.innerText),
        oldPrice: getPrice(container, [
          "[data-automation-id*='was-price' i]",
          "[data-testid*='old-price' i]",
          "[data-testid*='strike' i]",
          "[class*='old' i]",
          "[class*='strike' i]"
        ])
      };
    }

    const labelText = cleanText(priceContainer.innerText || priceContainer.textContent);
    const currentMatch = labelText.match(/precio actual\s*(\$\s?[\d,.]+)/i);
    const oldMatch = labelText.match(/antes\s*(\$\s?[\d,.]+)/i);
    const strike = cleanText(priceContainer.querySelector(".strike") && priceContainer.querySelector(".strike").innerText);
    const visibleMoneyValues = Array.from(priceContainer.querySelectorAll("[aria-hidden='true']"))
      .map((element) => cleanText(element.innerText || element.textContent))
      .flatMap(extractMoneyValues);
    const allMoneyValues = extractMoneyValues(labelText);

    return {
      price: cleanText(currentMatch && currentMatch[1]) || visibleMoneyValues[0] || allMoneyValues[0] || "",
      oldPrice: cleanText(oldMatch && oldMatch[1]) || strike || allMoneyValues[1] || ""
    };
  }

  function extractProduct(container) {
    const name = firstText(container, [
      "[data-automation-id*='product-title' i]",
      "[data-testid*='product-title' i]",
      "[itemprop='name']",
      "a[title]",
      "h2",
      "h3",
      "a[href*='/ip/']"
    ]);

    const prices = extractBodegaPrices(container);

    const product = {
      name,
      price: prices.price,
      oldPrice: prices.oldPrice,
      image: firstImage(container),
      link: firstLink(container),
      sku: getSku(container),
      rawText: truncate(cleanText(container.innerText), 1000)
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
      extractor: "bodegaaurrera",
      products,
      debug: {
        totalProductCandidates: candidates.length,
        totalProductsExtracted: products.length
      }
    };
  }

  window.DomExtractor.registerExtractor({
    id: "bodegaaurrera",
    domains: [
      "bodegaaurrera.com.mx",
      "www.bodegaaurrera.com.mx",
      "despensa.bodegaaurrera.com.mx"
    ],
    extract,
    collectCandidates
  });
})();
