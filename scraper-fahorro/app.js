const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const app = express();
const PORT = 3005;
const CAPTURES_DIR = path.join(__dirname, "captures");
const pendingScrapes = new Map();

app.use(cors());
app.use(express.json({ limit: "50mb" }));

function ensureCapturesDir() {
  if (!fs.existsSync(CAPTURES_DIR)) {
    fs.mkdirSync(CAPTURES_DIR, { recursive: true });
  }
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function captureFileName(date = new Date()) {
  const stamp = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("") + "-" + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");

  return `capture-${stamp}.json`;
}

function validateCapture(payload) {
  const requiredFields = ["url", "title", "timestamp", "text", "html", "products"];
  const missing = requiredFields.filter((field) => !(field in payload));

  if (missing.length > 0) {
    return `Missing required field(s): ${missing.join(", ")}`;
  }

  if (!Array.isArray(payload.products)) {
    return "Field products must be an array.";
  }

  return null;
}

function validateTargetUrl(targetUrl) {
  if (!targetUrl || typeof targetUrl !== "string") {
    return { error: "Query parameter url is required." };
  }

  try {
    const parsedUrl = new URL(targetUrl);

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return { error: "Only http and https URLs are allowed." };
    }

    return { parsedUrl };
  } catch (_error) {
    return { error: "Invalid URL." };
  }
}

function normalizeUrlForMatch(targetUrl) {
  const parsedUrl = new URL(targetUrl);
  parsedUrl.hash = "";
  return parsedUrl.href;
}

function openChrome(targetUrl, callback) {
  const escapedUrl = targetUrl.replace(/"/g, '\\"');
  const command = `start "" chrome "${escapedUrl}"`;

  exec(command, { windowsHide: true }, callback);
}

function createScrapeJob(targetUrl) {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const job = {
    id,
    url: targetUrl,
    normalizedUrl: normalizeUrlForMatch(targetUrl),
    status: "pending",
    createdAt: new Date().toISOString()
  };

  pendingScrapes.set(id, job);
  return job;
}

function findPendingScrapeByUrl(currentUrl) {
  const normalizedCurrentUrl = normalizeUrlForMatch(currentUrl);

  for (const job of pendingScrapes.values()) {
    if (job.status === "pending" && job.normalizedUrl === normalizedCurrentUrl) {
      return job;
    }
  }

  return null;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/capture", (req, res) => {
  const payload = req.body || {};
  const validationError = validateCapture(payload);

  if (validationError) {
    return res.status(400).json({ ok: false, error: validationError });
  }

  ensureCapturesDir();

  const fileName = captureFileName();
  const filePath = path.join(CAPTURES_DIR, fileName);

  const capture = {
    receivedAt: new Date().toISOString(),
    ...payload
  };

  fs.writeFileSync(filePath, JSON.stringify(capture, null, 2), "utf8");

  if (payload.jobId && pendingScrapes.has(payload.jobId)) {
    const job = pendingScrapes.get(payload.jobId);
    pendingScrapes.set(payload.jobId, {
      ...job,
      status: "completed",
      completedAt: new Date().toISOString(),
      file: fileName,
      products: payload.products.length
    });
  }

  res.json({
    ok: true,
    file: fileName,
    path: filePath,
    products: payload.products.length
  });
});

app.get("/open", (req, res) => {
  const targetUrl = req.query.url;
  const validation = validateTargetUrl(targetUrl);

  if (validation.error) {
    return res.status(400).json({ ok: false, error: validation.error });
  }

  openChrome(targetUrl, (error) => {
    if (error) {
      return res.status(500).json({
        ok: false,
        error: "Could not open Chrome. Verify Chrome is installed and available in PATH.",
        detail: error.message
      });
    }

    res.json({ ok: true, opened: targetUrl });
  });
});

app.get("/scrape", (req, res) => {
  const targetUrl = req.query.url;
  const validation = validateTargetUrl(targetUrl);

  if (validation.error) {
    return res.status(400).json({ ok: false, error: validation.error });
  }

  const job = createScrapeJob(targetUrl);

  openChrome(targetUrl, (error) => {
    if (error) {
      pendingScrapes.set(job.id, {
        ...job,
        status: "open_failed",
        error: error.message
      });

      return res.status(500).json({
        ok: false,
        error: "Scrape job was created, but Chrome could not be opened. Verify Chrome is installed and available in PATH.",
        detail: error.message,
        jobId: job.id
      });
    }

    res.json({
      ok: true,
      jobId: job.id,
      opened: targetUrl,
      message: "Chrome opened. The extension will capture the page automatically when the URL finishes loading."
    });
  });
});

app.get("/pending-scrape", (req, res) => {
  const currentUrl = req.query.url;
  const validation = validateTargetUrl(currentUrl);

  if (validation.error) {
    return res.status(400).json({ ok: false, error: validation.error });
  }

  const job = findPendingScrapeByUrl(currentUrl);

  if (!job) {
    return res.json({ ok: true, pending: false });
  }

  pendingScrapes.set(job.id, {
    ...job,
    status: "claimed",
    claimedAt: new Date().toISOString()
  });

  res.json({
    ok: true,
    pending: true,
    job: {
      id: job.id,
      url: job.url,
      waitBeforeCaptureMs: 4000
    }
  });
});

app.get("/scrape-jobs", (_req, res) => {
  res.json({
    ok: true,
    jobs: Array.from(pendingScrapes.values())
  });
});

app.listen(PORT, () => {
  ensureCapturesDir();
  console.log(`Fahorro capture backend running at http://localhost:${PORT}`);
});
