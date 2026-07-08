(function () {
  const CAPTURE_API_URL = "http://localhost:3005/capture";
  const PENDING_SCRAPE_API_URL = "http://localhost:3005/pending-scrape";
  const JOB_STATUS_API_URL = "http://localhost:3005/scrape-job-status";
  const AUTO_CAPTURE_FLAG = "__domExtractorAutoCaptureStarted";
  const PAGINATION_JOB_KEY = "__domExtractorPaginationJob";

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalizeText(value) {
    return (value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function isVisible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function clickElement(element) {
    if (!element) {
      throw new Error("No element found to click.");
    }

    element.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    element.click();
  }

  function clickElementCenter(element, xRatio = 0.5) {
    if (!element) {
      throw new Error("No element found to click.");
    }

    element.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    const rect = element.getBoundingClientRect();
    const x = rect.left + (rect.width * xRatio);
    const y = rect.top + (rect.height / 2);
    const target = document.elementFromPoint(x, y) || element;

    target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }));
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }));
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }));
  }

  function findVisibleElementByText(selector, requiredTexts, rejectedTexts = []) {
    const matches = findVisibleElementsByText(selector, requiredTexts, rejectedTexts);
    return matches[0] || null;
  }

  function findVisibleElementsByText(selector, requiredTexts, rejectedTexts = []) {
    const required = requiredTexts.map(normalizeText).filter(Boolean);
    const rejected = rejectedTexts.map(normalizeText).filter(Boolean);

    return Array.from(document.querySelectorAll(selector)).filter((element) => {
      if (!isVisible(element)) return false;

      const text = normalizeText(element.innerText || element.textContent || element.getAttribute("aria-label"));
      if (!text) return false;

      return required.every((part) => text.includes(part)) && !rejected.some((part) => text.includes(part));
    }).sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return (leftRect.width * leftRect.height) - (rightRect.width * rightRect.height);
    });
  }

  function findClickableFromElement(element) {
    if (!element) return null;
    return element.closest("button, a, label, [role='button']") || element;
  }

  async function waitUntilTextVisible(requiredTexts, timeoutMs = 10000) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const pageText = normalizeText(document.body ? document.body.innerText : "");
      const required = requiredTexts.map(normalizeText).filter(Boolean);

      if (required.every((part) => pageText.includes(part))) {
        return true;
      }

      await sleep(500);
    }

    return false;
  }

  async function waitForElementByText(selector, requiredTexts, timeoutMs = 10000, rejectedTexts = []) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const element = findVisibleElementByText(selector, requiredTexts, rejectedTexts);
      if (element) {
        return element;
      }

      await sleep(500);
    }

    return null;
  }

  function setNativeInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
  }

  function getHostname() {
    return window.location.hostname.toLowerCase();
  }

  function getExtractor(preferredExtractorId) {
    const registry = window.DomExtractor && window.DomExtractor.extractors;
    if (!registry) {
      throw new Error("Extractor registry is not loaded.");
    }

    if (preferredExtractorId && registry[preferredExtractorId]) {
      return registry[preferredExtractorId];
    }

    const hostname = getHostname();
    const extractors = Object.values(registry);
    const matched = extractors.find((extractor) => {
      return (extractor.domains || []).some((domain) => {
        return domain !== "*" && (hostname === domain || hostname.endsWith(`.${domain}`));
      });
    });

    return matched || registry.default;
  }

  function extractPageData(options = {}) {
    const selectedExtractor = getExtractor(options.extractor);
    const extraction = selectedExtractor.extract();

    return {
      domain: getHostname(),
      extractor: extraction.extractor || selectedExtractor.id,
      url: window.location.href,
      title: document.title,
      timestamp: new Date().toISOString(),
      Tienda: extraction.Tienda || "",
      text: document.body ? document.body.innerText : "",
      html: document.documentElement ? document.documentElement.outerHTML : "",
      products: extraction.products || [],
      debug: {
        selectedExtractor: selectedExtractor.id,
        ...(extraction.debug || {})
      }
    };
  }

  async function captureCurrentPage(extraFields = {}) {
    const cleanExtraFields = { ...extraFields };
    if (!cleanExtraFields.extractor) {
      delete cleanExtraFields.extractor;
    }

    const data = {
      ...extractPageData({ extractor: cleanExtraFields.extractor }),
      ...cleanExtraFields
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

  async function waitForProductCandidates(maxWaitMs, preferredExtractorId) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < maxWaitMs) {
      const extractor = getExtractor(preferredExtractorId);
      if (extractor.collectCandidates && extractor.collectCandidates().length > 0) {
        return true;
      }

      await sleep(1000);
    }

    return false;
  }

  async function autoScrollPage(options = {}) {
    const maxScrolls = Number(options.maxScrolls || 20);
    const scrollStepPx = Number(options.scrollStepPx || 900);
    const scrollDelayMs = Number(options.scrollDelayMs || 900);
    const scrollStagnantLimit = Number(options.scrollStagnantLimit || 2);
    const postScrollWaitMs = Number(options.postScrollWaitMs || 1000);
    let lastScrollHeight = document.documentElement.scrollHeight;
    let stagnantScrolls = 0;

    for (let index = 0; index < maxScrolls; index += 1) {
      window.scrollBy({ top: scrollStepPx, left: 0, behavior: "smooth" });
      await sleep(scrollDelayMs);

      const currentScrollHeight = document.documentElement.scrollHeight;
      const nearBottom = window.innerHeight + window.scrollY >= currentScrollHeight - 50;

      if (currentScrollHeight === lastScrollHeight && nearBottom) {
        stagnantScrolls += 1;
      } else {
        stagnantScrolls = 0;
      }

      lastScrollHeight = currentScrollHeight;

      if (stagnantScrolls >= scrollStagnantLimit) {
        break;
      }
    }

    await sleep(postScrollWaitMs);
    window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
    await sleep(1000);
  }

  function findLoadMoreButton(text) {
    const expected = normalizeText(text || "Ver mas productos");
    const elements = Array.from(document.querySelectorAll("button, a, [role='button']"));

    return elements.find((element) => {
      const label = normalizeText(element.innerText || element.textContent || element.getAttribute("aria-label"));
      const disabled = element.disabled || element.getAttribute("aria-disabled") === "true";
      const visible = element.offsetParent !== null;

      return visible && !disabled && label.includes(expected);
    });
  }

  async function clickLoadMoreButtons(options = {}) {
    const maxClicks = Number(options.maxLoadMoreClicks || 10);
    const delayMs = Number(options.loadMoreDelayMs || 1500);
    const text = options.loadMoreText || "Ver más productos";

    for (let index = 0; index < maxClicks; index += 1) {
      window.scrollTo({ top: document.documentElement.scrollHeight, left: 0, behavior: "smooth" });
      await sleep(700);

      const button = findLoadMoreButton(text);
      if (!button) {
        break;
      }

      button.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
      await sleep(300);
      button.click();
      await sleep(delayMs);
    }

    window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
    await sleep(1000);
  }

  function getCurrentPageNumber() {
    const value = new URL(window.location.href).searchParams.get("page");
    const page = Number(value || 1);
    return Number.isFinite(page) && page > 0 ? page : 1;
  }

  function buildPageUrl(pageNumber) {
    const url = new URL(window.location.href);
    url.searchParams.set("page", String(pageNumber));
    return url.href;
  }

  function getPaginationJobFromSession() {
    const raw = sessionStorage.getItem(PAGINATION_JOB_KEY);
    if (!raw) return null;

    try {
      const job = JSON.parse(raw);
      if (!job || !job.autoPaginate) return null;
      return job;
    } catch (_error) {
      sessionStorage.removeItem(PAGINATION_JOB_KEY);
      return null;
    }
  }

  function savePaginationJobToSession(job, pageNumber) {
    sessionStorage.setItem(PAGINATION_JOB_KEY, JSON.stringify({
      ...job,
      paginationPageNumber: pageNumber
    }));
  }

  function clearPaginationJobFromSession() {
    sessionStorage.removeItem(PAGINATION_JOB_KEY);
  }

  async function closeCurrentTab() {
    try {
      await sleep(500);
      chrome.runtime.sendMessage({ action: "closeTab" });
    } catch (error) {
      console.warn("Could not request tab close:", error.message);
    }
  }

  async function markScrapeJobStatus(jobId, status, error = "") {
    if (!jobId) return;

    try {
      await fetch(JOB_STATUS_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ jobId, status, error })
      });
    } catch (statusError) {
      console.warn("Could not update job status:", statusError.message);
    }
  }

  function findBodegaCurrentStoreSelector() {
    const storeButtons = Array.from(document.querySelectorAll("button"))
      .filter((element) => {
        if (!isVisible(element)) return false;

        const rect = element.getBoundingClientRect();
        const text = normalizeText(element.innerText || element.textContent || element.getAttribute("aria-label"));
        const hasRightChevron = Boolean(element.querySelector("i.ld-ChevronRight, .ld-ChevronRight"));

        if (!hasRightChevron) return false;
        if (text.includes("agregar direccion") || text.includes("agrega una direccion")) return false;

        // The current-store selector is a real button inside the left delivery panel.
        return rect.left < 460 && rect.top > 210 && rect.width > 120 && rect.height > 35;
      })
      .sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return (leftRect.width * leftRect.height) - (rightRect.width * rightRect.height);
      });

    if (storeButtons[0]) {
      return storeButtons[0];
    }

    const fallbackCandidates = Array.from(document.querySelectorAll("button, [role='button'], a, label, div"))
      .filter((element) => {
        if (!isVisible(element)) return false;

        const rect = element.getBoundingClientRect();
        const text = normalizeText(element.innerText || element.textContent || element.getAttribute("aria-label"));
        const hasRightChevron = Boolean(element.querySelector("i.ld-ChevronRight, .ld-ChevronRight"));

        if (text.includes("agregar direccion") || text.includes("agrega una direccion")) return false;
        if (!hasRightChevron && rect.height < 50) return false;

        return rect.left < 460 && rect.top > 210 && rect.width > 120 && rect.height > 35;
      })
      .sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return (leftRect.width * leftRect.height) - (rightRect.width * rightRect.height);
      });

    return fallbackCandidates[0] || null;
  }

  function findBodegaStoreResult(storeName) {
    const required = normalizeText(storeName).split(" ").filter(Boolean);
    const candidates = Array.from(document.querySelectorAll("button, [role='button'], label, div"))
      .filter((element) => {
        if (!isVisible(element)) return false;

        const rect = element.getBoundingClientRect();
        const text = normalizeText(element.innerText || element.textContent || element.getAttribute("aria-label"));

        if (required.length > 0 && !required.every((part) => text.includes(part))) return false;
        if (required.length === 0 && !text.includes("bodega aurrera")) return false;

        // Store results are rendered in the right drawer.
        return rect.left > (window.innerWidth * 0.45) && rect.width > 120 && rect.height > 25;
      })
      .sort((left, right) => {
        const leftRadio = left.querySelector && left.querySelector("input[type='radio']");
        const rightRadio = right.querySelector && right.querySelector("input[type='radio']");
        if (leftRadio && !rightRadio) return -1;
        if (!leftRadio && rightRadio) return 1;

        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return (rightRect.width * rightRect.height) - (leftRect.width * leftRect.height);
      });

    return candidates[0] || null;
  }

  function findBodegaStoreRadio(storeName) {
    const expectedName = normalizeText(storeName);
    const labels = Array.from(document.querySelectorAll("label[data-automation-id='pickup-store']"))
      .filter(isVisible)
      .map((label) => {
        const nameElement = label.querySelector("span.b.f5.lh-copy.dark-gray");
        const labelText = normalizeText(label.innerText || label.textContent || "");
        const storeText = normalizeText(nameElement && (nameElement.innerText || nameElement.textContent));
        const radio = label.querySelector("input[type='radio'][name='pickup-store']");

        return {
          label,
          radio,
          storeText,
          labelText,
          exact: storeText === expectedName,
          contains: Boolean(expectedName) && storeText.includes(expectedName)
        };
      })
      .filter((candidate) => candidate.radio && candidate.storeText);

    const exactMatch = labels.find((candidate) => candidate.exact);
    if (exactMatch) {
      return exactMatch.radio;
    }

    const containsMatches = labels
      .filter((candidate) => candidate.contains)
      .sort((left, right) => left.storeText.length - right.storeText.length);

    if (containsMatches[0]) {
      return containsMatches[0].radio;
    }

    const tokenMatches = labels.filter((candidate) => {
      const tokens = expectedName.split(" ").filter(Boolean);
      return tokens.length > 0 && tokens.every((token) => candidate.storeText.includes(token));
    });

    if (tokenMatches[0]) {
      return tokenMatches[0].radio;
    }

    return null;
  }

  async function clickBodegaChooseButton() {
    const startedAt = Date.now();
    let chooseButton = null;

    while (Date.now() - startedAt < 8000) {
      chooseButton = document.querySelector("button[data-automation-id='save-label']")
        || findVisibleElementByText("button", ["elegir"]);

      if (chooseButton && isVisible(chooseButton) && !chooseButton.disabled && chooseButton.getAttribute("aria-disabled") !== "true") {
        break;
      }

      await sleep(500);
    }

    if (!chooseButton || !isVisible(chooseButton)) {
      throw new Error("Bodega choose button was not found.");
    }

    clickElement(chooseButton);
    await sleep(2500);
  }

  async function openBodegaStoreDrawer() {
    const locationHeader = await waitForElementByText("button, [role='button'], div, span", ["elige como quieres recibir el pedido"], 8000);
    if (locationHeader) {
      clickElement(findClickableFromElement(locationHeader));
      await sleep(1200);
    }

    if (await waitUntilTextVisible(["elegir tienda"], 1000)) {
      return;
    }

    const storeSelector = findBodegaCurrentStoreSelector() || findVisibleElementByText(
      "button, [role='button'], a, label, div",
      ["tienda de invitado"],
      ["agregar direccion", "agrega una direccion"]
    );

    if (!storeSelector) {
      throw new Error("Bodega store selector was not found.");
    }

    if (storeSelector.tagName === "BUTTON") {
      clickElement(storeSelector);
    } else {
      clickElementCenter(findClickableFromElement(storeSelector), 0.88);
    }

    if (!(await waitUntilTextVisible(["elegir tienda"], 6000))) {
      clickElementCenter(storeSelector, 0.88);
      await sleep(1500);
    }
  }

  async function fillBodegaZipCode(zipCode) {
    const drawerTitle = await waitForElementByText("h1, h2, h3, [role='heading'], div, span", ["elegir tienda"], 10000);
    if (!drawerTitle) {
      throw new Error("Bodega store drawer did not open.");
    }

    const inputs = Array.from(document.querySelectorAll("input[type='text'], input[type='search'], input:not([type])"))
      .filter(isVisible)
      .sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return rightRect.left - leftRect.left;
      });

    const input = inputs[0];
    if (!input) {
      throw new Error("Bodega zip code input was not found.");
    }

    input.focus();
    setNativeInputValue(input, zipCode);
    await sleep(2500);
  }

  async function selectBodegaStore(zipCode, storeName) {
    const startedAt = Date.now();
    let preferredStore = null;
    let preferredRadio = null;

    while (Date.now() - startedAt < 8000) {
      preferredRadio = findBodegaStoreRadio(storeName);
      preferredStore = preferredRadio ? null : findBodegaStoreResult(storeName);
      if (preferredRadio || preferredStore) break;
      await sleep(500);
    }

    const fallbackStore = preferredStore || findVisibleElementByText(
      "button, [role='button'], label, div",
      ["bodega aurrera"],
      ["agregar direccion", "agrega una direccion"]
    );

    if (!fallbackStore) {
      throw new Error(`No Bodega Aurrera store result was found for zip code ${zipCode}.`);
    }

    const radio = preferredRadio || (fallbackStore.querySelector && fallbackStore.querySelector("input[type='radio'][name='pickup-store'], input[type='radio']"));
    if (radio) {
      clickElement(radio);
    } else {
      clickElementCenter(findClickableFromElement(fallbackStore), 0.08);
    }

    await sleep(1000);
    await clickBodegaChooseButton();
  }

  async function runBodegaSetStore(job) {
    const zipCode = String(job.zipCode || "67350");
    const storeName = String(job.storeName || "Allende Zuazua");

    console.log("Starting Bodega store setup job:", {
      jobId: job.id,
      zipCode,
      storeName
    });

    await sleep(job.waitBeforeCaptureMs || 2500);
    await openBodegaStoreDrawer();
    await fillBodegaZipCode(zipCode);
    await selectBodegaStore(zipCode, storeName);

    await markScrapeJobStatus(job.id, "completed");

    console.log("Bodega store setup finished:", {
      jobId: job.id,
      zipCode,
      storeName
    });

    if (job.closeTab) {
      await closeCurrentTab();
    }
  }

  function hasPaginationEvidence() {
    const hasNumberedPageControl = Boolean(Array.from(document.querySelectorAll("a[href], button, [role='button']")).find((element) => {
      const label = (element.innerText || element.textContent || "").trim();
      const href = element.getAttribute && element.getAttribute("href");
      const pageFromHref = href && href.match(/[?&]page=(\d+)/i);

      return (Number(label) > 1) || (pageFromHref && Number(pageFromHref[1]) > 1);
    }));

    return hasNumberedPageControl || getMaxVisiblePageNumber() > 1;
  }

  function getMaxVisiblePageNumber() {
    const numbers = Array.from(document.querySelectorAll("a[href], button, [role='button']"))
      .map((element) => Number((element.innerText || element.textContent || "").trim()))
      .filter((value) => Number.isFinite(value) && value > 0);

    return numbers.length > 0 ? Math.max(...numbers) : 0;
  }

  async function getNextPaginatedUrl(job) {
    if (!job || !job.autoPaginate) return "";

    window.scrollTo({ top: document.documentElement.scrollHeight, left: 0, behavior: "smooth" });
    await sleep(900);

    const currentPage = getCurrentPageNumber();
    const maxPages = Number(job.maxPages || 10);
    const maxVisiblePage = getMaxVisiblePageNumber();
    const hasNext = maxVisiblePage > 1 && currentPage < maxVisiblePage;

    if (!hasPaginationEvidence() || currentPage >= maxPages || !hasNext) {
      clearPaginationJobFromSession();
      window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
      return "";
    }

    return buildPageUrl(currentPage + 1);
  }

  async function getPendingScrape() {
    const url = `${PENDING_SCRAPE_API_URL}?url=${encodeURIComponent(window.location.href)}`;
    const response = await fetch(url);

    if (!response.ok) {
      return null;
    }

    return response.json();
  }

  async function getCurrentJob() {
    const pending = await getPendingScrape();
    if (pending && pending.pending && pending.job) {
      return pending.job;
    }

    return getPaginationJobFromSession();
  }

  async function autoCapturePendingScrape() {
    if (window[AUTO_CAPTURE_FLAG]) {
      return;
    }

    window[AUTO_CAPTURE_FLAG] = true;
    let activeJob = null;

    try {
      await sleep(1500);

      const job = await getCurrentJob();
      activeJob = job;
      if (!job) {
        return;
      }

      console.log("Scrape job found:", job);

      if (job.action === "setStore") {
        await runBodegaSetStore(job);
        return;
      }

      await sleep(job.waitBeforeCaptureMs || 4000);

      if (job.autoScroll) {
        await autoScrollPage({
          maxScrolls: job.maxScrolls,
          scrollStepPx: job.scrollStepPx,
          scrollDelayMs: job.scrollDelayMs,
          scrollStagnantLimit: job.scrollStagnantLimit,
          postScrollWaitMs: job.postScrollWaitMs
        });
      }

      if (job.clickLoadMore) {
        await clickLoadMoreButtons({
          loadMoreText: job.loadMoreText,
          maxLoadMoreClicks: job.maxLoadMoreClicks,
          loadMoreDelayMs: job.loadMoreDelayMs
        });
      }

      await waitForProductCandidates(15000, job.extractor);

      const result = await captureCurrentPage({
        jobId: job.id,
        captureMode: "auto",
        extractor: job.extractor,
        autoScroll: Boolean(job.autoScroll),
        autoPaginate: Boolean(job.autoPaginate),
        pageNumber: getCurrentPageNumber(),
        clickLoadMore: Boolean(job.clickLoadMore),
        saveDb: Boolean(job.saveDb)
      });

      console.log("Automatic capture saved:", result);

      const nextUrl = await getNextPaginatedUrl(job);
      if (nextUrl) {
        savePaginationJobToSession(job, getCurrentPageNumber() + 1);
        await sleep(job.paginationDelayMs || 2500);
        window.location.href = nextUrl;
        return;
      }

      if (job.closeTab) {
        await closeCurrentTab();
      }
    } catch (error) {
      if (activeJob && activeJob.action === "setStore") {
        await markScrapeJobStatus(activeJob.id, "failed", error.message);
      }

      console.warn("Automatic capture did not run:", error.message);
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.action !== "extract") {
      return false;
    }

    captureCurrentPage({ captureMode: "manual", extractor: message.extractor })
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
