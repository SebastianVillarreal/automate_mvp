(function () {
  const defaultExtractor = window.DomExtractor.extractors.default;
  const { cleanText, dedupeProducts, firstImage, firstLink, firstText, getPrice, truncate } = window.DomExtractor.helpers;

  function getSku(container) {
    const addToCartForm = container.querySelector("form[data-role='tocart-form'][data-product-sku]");
    const addToCartSku = cleanText(addToCartForm && addToCartForm.getAttribute("data-product-sku"));
    if (addToCartSku) return addToCartSku;

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

  function collectCandidates() {
    return defaultExtractor.collectCandidates();
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
      extractor: "fahorro",
      products,
      debug: {
        totalProductCandidates: candidates.length,
        totalProductsExtracted: products.length
      }
    };
  }

  window.DomExtractor.registerExtractor({
    id: "fahorro",
    domains: ["fahorro.com", "www.fahorro.com"],
    extract,
    collectCandidates
  });
})();
