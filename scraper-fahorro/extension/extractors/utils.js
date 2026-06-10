(function () {
  const root = window.DomExtractor || {};

  function cleanText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function truncate(value, maxLength) {
    const text = value || "";
    return text.length > maxLength ? text.slice(0, maxLength) : text;
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
      const text = cleanText(element && (element.innerText || element.textContent));
      if (text) return text;

      const content = cleanText(element && element.getAttribute && element.getAttribute("content"));
      if (content) return content;

      const title = cleanText(element && element.getAttribute && element.getAttribute("title"));
      if (title) return title;

      const ariaLabel = cleanText(element && element.getAttribute && element.getAttribute("aria-label"));
      if (ariaLabel) return ariaLabel;
    }

    return "";
  }

  function firstAttribute(container, selectors, attributes) {
    for (const selector of selectors) {
      const element = container.querySelector(selector);
      if (!element) continue;

      for (const attr of attributes) {
        const value = cleanText(element.getAttribute(attr));
        if (value) return value;
      }
    }

    return "";
  }

  function firstImage(container) {
    return absoluteUrl(firstAttribute(container, ["img"], [
      "src",
      "data-src",
      "data-original",
      "data-lazy",
      "srcset"
    ]).split(" ")[0]);
  }

  function firstLink(container) {
    const link = container.querySelector("a[href]");
    return link ? absoluteUrl(link.getAttribute("href")) : "";
  }

  function getPrice(container, selectors) {
    for (const selector of selectors) {
      const element = container.querySelector(selector);
      if (!element) continue;

      const dataPrice = cleanText(element.getAttribute("data-price-amount"));
      if (dataPrice) return dataPrice;

      const content = cleanText(element.getAttribute("content"));
      if (content) return content;

      const ariaLabel = cleanText(element.getAttribute("aria-label"));
      if (ariaLabel && /\$|\d/.test(ariaLabel)) return ariaLabel;

      const text = cleanText(element.innerText || element.textContent);
      if (text && /\$|\d/.test(text)) return text;
    }

    return "";
  }

  function extractFirstMoney(text) {
    const match = cleanText(text).match(/(?:\$|MXN|MN)\s?[\d,.]+|[\d,.]+\s?(?:MXN|MN)/i);
    return match ? cleanText(match[0]) : "";
  }

  function dedupeProducts(products) {
    const seenLinks = new Set();
    const seenSku = new Set();
    const seenNamePrice = new Set();
    const unique = [];

    for (const product of products) {
      const linkKey = product.link && product.link.toLowerCase();
      const skuKey = product.sku && product.sku.toLowerCase();
      const namePriceKey = `${(product.name || "").toLowerCase()}|${(product.price || "").toLowerCase()}`;

      if (linkKey && seenLinks.has(linkKey)) continue;
      if (skuKey && seenSku.has(skuKey)) continue;
      if (!linkKey && !skuKey && product.name && product.price && seenNamePrice.has(namePriceKey)) continue;

      if (linkKey) seenLinks.add(linkKey);
      if (skuKey) seenSku.add(skuKey);
      if (product.name && product.price) seenNamePrice.add(namePriceKey);

      unique.push(product);
    }

    return unique;
  }

  root.extractors = root.extractors || {};
  root.registerExtractor = function registerExtractor(extractor) {
    root.extractors[extractor.id] = extractor;
  };

  root.helpers = {
    absoluteUrl,
    cleanText,
    dedupeProducts,
    extractFirstMoney,
    firstAttribute,
    firstImage,
    firstLink,
    firstText,
    getPrice,
    truncate
  };

  window.DomExtractor = root;
})();
