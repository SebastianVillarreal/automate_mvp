(function () {
  const { absoluteUrl, cleanText, dedupeProducts, extractFirstMoney, firstImage, firstLink, getPrice, truncate } = window.DomExtractor.helpers;

  function looksLikeMercoProduct(element) {
    const text = cleanText(element.innerText);
    if (!text || text.length < 8) return false;

    if (element.matches("div.sc-76a3b6d8-0.hlsEFO") && element.querySelector("div.sc-d21d496b-1.kxGerz")) {
      return true;
    }

    const hasImage = Boolean(element.querySelector("img"));
    const hasLink = Boolean(element.querySelector("a[href]"));
    const hasPrice = Boolean(element.querySelector("[class*='price' i], [data-testid*='price' i], [aria-label*='$']")) || Boolean(extractFirstMoney(text));
    const hasName = Boolean(element.querySelector("[class*='name' i], [class*='title' i], [data-testid*='name' i], [data-testid*='title' i], a[title], h2, h3"));

    return hasPrice && (hasName || (hasImage && hasLink));
  }

  function collectCandidates() {
    const mercoCards = Array.from(document.querySelectorAll("div.sc-76a3b6d8-0.hlsEFO"))
      .filter((element) => element.querySelector("div.sc-d21d496b-1.kxGerz"));

    if (mercoCards.length > 0) {
      return mercoCards;
    }

    const mercoDetailCards = Array.from(document.querySelectorAll("div.sc-d21d496b-1.kxGerz"))
      .map((element) => element.closest("div.sc-76a3b6d8-0.hlsEFO") || element.closest("article") || element.parentElement)
      .filter(Boolean);

    if (mercoDetailCards.length > 0) {
      return Array.from(new Set(mercoDetailCards));
    }

    const selectors = [
      "div.sc-76a3b6d8-0.hlsEFO",
      "div:has(> div.sc-d21d496b-1.kxGerz)",
      "[data-product-id]",
      "[data-product-sku]",
      "[data-sku]",
      "[data-testid*='product' i]",
      "[class*='product' i]",
      "[class*='card' i]",
      "[class*='item' i]",
      "article",
      "li",
      "div:has(img):has(a[href])"
    ];

    const candidates = new Set();

    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((element) => {
        if (looksLikeMercoProduct(element)) {
          candidates.add(element);
        }
      });
    }

    return Array.from(candidates);
  }

  function getDetailsContainer(container) {
    return container.querySelector("div.sc-d21d496b-1.kxGerz") || container;
  }

  function getSku(container) {
    const details = getDetailsContainer(container);
    const skuMatch = cleanText(details.innerText || details.textContent).match(/\bsku\s*:\s*([A-Za-z0-9_-]+)/i);
    if (skuMatch) return skuMatch[1];

    const attributes = [
      "data-product-sku",
      "data-sku",
      "data-product-id",
      "data-id",
      "data-item-id"
    ];

    for (const attr of attributes) {
      const value = cleanText(container.getAttribute(attr));
      if (value) return value;
    }

    const skuElement = container.querySelector("[data-product-sku], [data-sku], [data-product-id], [data-id], [data-item-id]");
    if (skuElement) {
      for (const attr of attributes) {
        const value = cleanText(skuElement.getAttribute(attr));
        if (value) return value;
      }
    }

    const link = getProductLink(container);
    const fromUrl = link.match(/\/(?:p|producto|product)\/([^/?#]+)/i) || link.match(/-([a-z0-9]{6,})(?:[/?#]|$)/i);
    return fromUrl ? fromUrl[1] : "";
  }

  function getProductLink(container) {
    const link = container.querySelector("a[href^='/p/'], a[href*='/p/']");
    return link ? absoluteUrl(link.getAttribute("href")) : firstLink(container);
  }

  function getProductImage(container) {
    const productLink = container.querySelector("a[href^='/p/'], a[href*='/p/']");
    const img = productLink && productLink.querySelector("img");
    if (img) {
      return absoluteUrl(img.getAttribute("src") || img.getAttribute("data-src"));
    }

    return firstImage(container);
  }

  function normalizePriceText(value) {
    const normalized = cleanText(value)
      .replace(/\$\s?(\d+)\.\s+(\d{2})/, "$$$1.$2")
      .replace(/\$\s?(\d+)\s+(\d{2})/, "$$$1.$2");
    const money = normalized.match(/\$\s?[\d,.]+/);

    return money ? money[0] : normalized;
  }

  function getMercoName(container, details) {
    const selectors = [
      "div > a[href^='/p/'] > p",
      "div > a[href*='/p/'] > p",
      "a[href^='/p/'] p",
      "a[href*='/p/'] p"
    ];

    for (const root of [details, container]) {
      for (const selector of selectors) {
        const nameElement = root.querySelector(selector);
        const name = cleanText(nameElement && (nameElement.textContent || nameElement.innerText));
        if (name) return name;
      }
    }

    const productLink = container.querySelector("a[href^='/p/'], a[href*='/p/']");
    const linkText = cleanText(productLink && (productLink.textContent || productLink.innerText));
    if (linkText) return linkText;

    const img = container.querySelector("a[href^='/p/'] img, a[href*='/p/'] img, img[alt]");
    return cleanText(img && img.getAttribute("alt"));
  }

  function getCurrentPrice(details) {
    const currentPriceElement = details.querySelector(".sc-45630bea-1.sc-45630bea-2");
    const currentPriceText = normalizePriceText(currentPriceElement && (currentPriceElement.innerText || currentPriceElement.textContent));

    if (currentPriceText) {
      return currentPriceText;
    }

    const priceBlock = details.querySelector(".sc-45630bea-0");
    const nonStruckPrices = Array.from(priceBlock ? priceBlock.querySelectorAll("span") : [])
      .filter((element) => {
        const style = (element.getAttribute("style") || "").toLowerCase();
        return !style.includes("line-through") && !element.closest("[style*='line-through']");
      })
      .map((element) => normalizePriceText(element.innerText || element.textContent))
      .filter((value) => value.includes("$"));

    return nonStruckPrices[0] || "";
  }

  function getOldPrice(details) {
    const struckElement = details.querySelector(".sc-45630bea-0 span[style*='line-through'], .sc-45630bea-0 s, .sc-45630bea-0 del");
    return normalizePriceText(struckElement && (struckElement.innerText || struckElement.textContent));
  }

  function extractMercoPrices(container) {
    const details = getDetailsContainer(container);
    const detailsText = cleanText(details.innerText || details.textContent);
    const price = getCurrentPrice(details) || getPrice(details, [
      "[data-testid*='price' i]",
      "[class*='price' i]",
      "[aria-label*='$']",
      "[itemprop='price']"
    ]) || extractFirstMoney(detailsText);

    const oldPrice = getOldPrice(details) || getPrice(details, [
      "[data-testid*='old-price' i]",
      "[data-testid*='was-price' i]",
      "[class*='old' i]",
      "[class*='before' i]",
      "[class*='strike' i]",
      "s",
      "del"
    ]);

    return {
      price: cleanText(price),
      oldPrice: cleanText(oldPrice)
    };
  }

  function extractProduct(container) {
    const details = getDetailsContainer(container);
    const productLink = details.querySelector("a[href^='/p/'], a[href*='/p/']");
    const name = getMercoName(container, details) || cleanText(productLink && (productLink.textContent || productLink.innerText));

    const prices = extractMercoPrices(container);

    const product = {
      name,
      price: prices.price,
      oldPrice: prices.oldPrice,
      image: getProductImage(container),
      link: getProductLink(container),
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
      extractor: "merco",
      products,
      debug: {
        totalProductCandidates: candidates.length,
        totalProductsExtracted: products.length
      }
    };
  }

  window.DomExtractor.registerExtractor({
    id: "merco",
    domains: ["merco.mx", "www.merco.mx", "adomicilio.merco.mx"],
    extract,
    collectCandidates
  });
})();
