(function () {
  const { cleanText, dedupeProducts, extractFirstMoney, firstImage, firstLink, firstText, getPrice, truncate } = window.DomExtractor.helpers;

  function looksLikeSorianaProduct(element) {
    const text = cleanText(element.innerText);
    if (!text || text.length < 8) return false;

    const hasProductLink = Boolean(element.querySelector("a[href*='/p/'], a[href*='/producto/'], a[href*='.html']"));
    const hasName = Boolean(element.querySelector(".pdp-link, .product-name, .product-tile-name, [itemprop='name'], a[title], h2, h3"));
    const hasPrice = Boolean(element.querySelector(".sales, .price, .value, [itemprop='price'], [data-price]")) || Boolean(extractFirstMoney(text));

    return hasPrice && (hasProductLink || hasName);
  }

  function collectCandidates() {
    const selectors = [
      "[data-pid]",
      "[data-product-id]",
      "[data-product-sku]",
      ".product-tile",
      ".product",
      ".product-item",
      "[class*='product' i]",
      "div:has(a[href*='/p/'])",
      "li:has(a[href*='/p/'])",
      "article",
      "li"
    ];

    const candidates = new Set();

    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((element) => {
        if (looksLikeSorianaProduct(element)) {
          candidates.add(element);
        }
      });
    }

    return Array.from(candidates);
  }

  function getProductImageUrl(container) {
    const images = Array.from(container.querySelectorAll("img"));

    for (const image of images) {
      const urls = [
        image.getAttribute("data-src"),
        image.getAttribute("src"),
        image.getAttribute("data-original"),
        image.getAttribute("data-lazy")
      ].filter(Boolean);

      const productUrl = urls.find((url) => /\/images\/product\//i.test(url) && !url.startsWith("data:image"));
      if (productUrl) {
        try {
          return new URL(productUrl, window.location.href).href;
        } catch (_error) {
          return productUrl;
        }
      }
    }

    return firstImage(container);
  }

  function getSku(container) {
    const imageUrl = getProductImageUrl(container);
    const skuFromImage = imageUrl && imageUrl.match(/\/images\/product\/([^_/?#]+)/i);
    if (skuFromImage) return skuFromImage[1];

    const attributes = [
      "data-pid",
      "data-product-id",
      "data-product-sku",
      "data-sku",
      "data-id"
    ];

    for (const attr of attributes) {
      const value = cleanText(container.getAttribute(attr));
      if (value) return value;
    }

    const skuElement = container.querySelector("[data-pid], [data-product-id], [data-product-sku], [data-sku], [data-id]");
    if (skuElement) {
      for (const attr of attributes) {
        const value = cleanText(skuElement.getAttribute(attr));
        if (value) return value;
      }
    }

    const link = firstLink(container);
    const productIdFromUrl = link.match(/(?:pid=|\/p\/|\/producto\/)([A-Za-z0-9_-]+)/i);
    return productIdFromUrl ? productIdFromUrl[1] : "";
  }

  function extractSorianaPrices(container) {
    const priceRoot = container.querySelector(".price, .prices, .product-price, [class*='price' i]") || container;
    const text = cleanText(priceRoot.innerText || priceRoot.textContent);
    const moneyValues = text.match(/\$\s?[\d,.]+/g) || [];

    const price = getPrice(container, [
      ".sales .value",
      ".sales",
      ".price .value",
      ".price-sales",
      ".value",
      "[itemprop='price']",
      "[data-price]"
    ]) || moneyValues[0] || extractFirstMoney(text);

    let oldPrice = getPrice(container, [
      ".strike-through .value",
      ".strike-through",
      ".list .value",
      ".list",
      ".old-price",
      ".price-old",
      "[class*='old' i]"
    ]) || moneyValues.find((value) => value !== price) || "";

    if (/\/\s*unidad/i.test(oldPrice)) {
      oldPrice = price;
    }

    return {
      price: cleanText(price),
      oldPrice: cleanText(oldPrice)
    };
  }

  function extractProduct(container) {
    const name = firstText(container, [
      ".pdp-link a",
      ".pdp-link",
      ".product-tile-name",
      ".product-name",
      "[itemprop='name']",
      "a[title]",
      "h2",
      "h3"
    ]);

    const prices = extractSorianaPrices(container);

    const product = {
      name,
      price: prices.price,
      oldPrice: prices.oldPrice,
      image: getProductImageUrl(container),
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
      extractor: "soriana",
      products,
      debug: {
        totalProductCandidates: candidates.length,
        totalProductsExtracted: products.length
      }
    };
  }

  window.DomExtractor.registerExtractor({
    id: "soriana",
    domains: ["soriana.com", "www.soriana.com"],
    extract,
    collectCandidates
  });
})();
