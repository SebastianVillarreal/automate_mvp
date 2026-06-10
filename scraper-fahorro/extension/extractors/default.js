(function () {
  const { cleanText, dedupeProducts, extractFirstMoney, firstImage, firstLink, firstText, getPrice, truncate } = window.DomExtractor.helpers;

  function getSku(container) {
    const attributes = [
      "data-product-sku",
      "data-sku",
      "data-product-id",
      "data-id",
      "data-product"
    ];

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
    const hasPrice = Boolean(element.querySelector(".price, .special-price, [data-price-amount], [itemprop='price'], [data-testid*='price' i]"));
    const hasImageOrLink = Boolean(element.querySelector("img, a[href]"));
    const textHasPrice = Boolean(extractFirstMoney(text));

    return (hasName && (hasPrice || textHasPrice)) || (hasPrice && hasImageOrLink);
  }

  function collectCandidates() {
    const selectorGroups = [
      "[class*='product' i]",
      "[data-product-id]",
      "[data-product-sku]",
      "[data-sku]",
      "[itemtype*='Product' i]",
      "[data-testid*='product' i]",
      "[data-automation-id*='product' i]",
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
      "[data-testid*='product-title' i]",
      "[data-automation-id*='product-title' i]",
      "a[title]",
      "h2",
      "h3"
    ]);

    const price = getPrice(container, [
      ".special-price .price",
      ".price",
      ".special-price",
      "[data-price-amount]",
      "[itemprop='price']",
      "[data-testid*='price' i]",
      "[data-automation-id*='price' i]"
    ]) || extractFirstMoney(container.innerText);

    const oldPrice = getPrice(container, [
      ".old-price .price",
      ".old-price",
      ".was-price",
      ".price-old",
      "[data-testid*='old-price' i]",
      "[data-automation-id*='was-price' i]"
    ]);

    const product = {
      name,
      price,
      oldPrice,
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
      extractor: "default",
      products,
      debug: {
        totalProductCandidates: candidates.length,
        totalProductsExtracted: products.length
      }
    };
  }

  window.DomExtractor.registerExtractor({
    id: "default",
    domains: ["*"],
    extract,
    collectCandidates
  });
})();
