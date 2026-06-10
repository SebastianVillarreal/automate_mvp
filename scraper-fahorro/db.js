const sql = require("mssql");

let poolPromise;

function boolFromEnv(value, defaultValue) {
  if (value === undefined || value === "") return defaultValue;
  return ["1", "true", "yes", "y"].includes(String(value).toLowerCase());
}

function getDbConfig() {
  const required = ["SQLSERVER_HOST", "SQLSERVER_DATABASE", "SQLSERVER_USER", "SQLSERVER_PASSWORD"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing SQL Server environment variable(s): ${missing.join(", ")}`);
  }

  return {
    server: process.env.SQLSERVER_HOST,
    port: Number(process.env.SQLSERVER_PORT || 1433),
    database: process.env.SQLSERVER_DATABASE,
    user: process.env.SQLSERVER_USER,
    password: process.env.SQLSERVER_PASSWORD,
    options: {
      encrypt: boolFromEnv(process.env.SQLSERVER_ENCRYPT, false),
      trustServerCertificate: boolFromEnv(process.env.SQLSERVER_TRUST_CERT, true)
    },
    pool: {
      max: 5,
      min: 0,
      idleTimeoutMillis: 30000
    }
  };
}

async function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect(getDbConfig());
  }

  return poolPromise;
}

async function ensureSchema(pool) {
  await pool.request().query(`
IF OBJECT_ID('dbo.ScrapeProducts', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ScrapeProducts (
    id INT IDENTITY(1,1) PRIMARY KEY,
    captureId INT NOT NULL,
    name NVARCHAR(1000) NULL,
    price NVARCHAR(255) NULL,
    oldPrice NVARCHAR(255) NULL,
    image NVARCHAR(2000) NULL,
    link NVARCHAR(2000) NULL,
    sku NVARCHAR(255) NULL,
    rawText NVARCHAR(MAX) NULL,
    rawJson NVARCHAR(MAX) NULL,
    createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
END;

IF OBJECT_ID('dbo.ScrapeCaptures', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ScrapeCaptures (
    id INT IDENTITY(1,1) PRIMARY KEY,
    jobId NVARCHAR(255) NULL,
    captureMode NVARCHAR(50) NULL,
    domain NVARCHAR(255) NULL,
    extractor NVARCHAR(255) NULL,
    url NVARCHAR(2000) NOT NULL,
    title NVARCHAR(1000) NULL,
    pageTimestamp DATETIME2 NULL,
    receivedAt DATETIME2 NOT NULL,
    fileName NVARCHAR(255) NULL,
    productCount INT NOT NULL DEFAULT 0,
    debugJson NVARCHAR(MAX) NULL,
    text NVARCHAR(MAX) NULL,
    html NVARCHAR(MAX) NULL,
    rawJson NVARCHAR(MAX) NULL
  );
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.foreign_keys
  WHERE name = 'FK_ScrapeProducts_ScrapeCaptures'
)
BEGIN
  ALTER TABLE dbo.ScrapeProducts
    ADD CONSTRAINT FK_ScrapeProducts_ScrapeCaptures
    FOREIGN KEY (captureId) REFERENCES dbo.ScrapeCaptures(id);
END;
`);
}

function inputNullable(request, name, type, value) {
  request.input(name, type, value === undefined ? null : value);
}

async function saveCaptureToDb(capture, fileName) {
  const pool = await getPool();
  await ensureSchema(pool);

  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    const captureRequest = new sql.Request(transaction);
    inputNullable(captureRequest, "jobId", sql.NVarChar(255), capture.jobId);
    inputNullable(captureRequest, "captureMode", sql.NVarChar(50), capture.captureMode);
    inputNullable(captureRequest, "domain", sql.NVarChar(255), capture.domain);
    inputNullable(captureRequest, "extractor", sql.NVarChar(255), capture.extractor);
    inputNullable(captureRequest, "url", sql.NVarChar(2000), capture.url);
    inputNullable(captureRequest, "title", sql.NVarChar(1000), capture.title);
    inputNullable(captureRequest, "pageTimestamp", sql.DateTime2, capture.timestamp ? new Date(capture.timestamp) : null);
    inputNullable(captureRequest, "receivedAt", sql.DateTime2, capture.receivedAt ? new Date(capture.receivedAt) : new Date());
    inputNullable(captureRequest, "fileName", sql.NVarChar(255), fileName);
    inputNullable(captureRequest, "productCount", sql.Int, capture.products.length);
    inputNullable(captureRequest, "debugJson", sql.NVarChar(sql.MAX), JSON.stringify(capture.debug || null));
    inputNullable(captureRequest, "text", sql.NVarChar(sql.MAX), capture.text);
    inputNullable(captureRequest, "html", sql.NVarChar(sql.MAX), capture.html);
    inputNullable(captureRequest, "rawJson", sql.NVarChar(sql.MAX), JSON.stringify(capture));

    const captureResult = await captureRequest.query(`
INSERT INTO dbo.ScrapeCaptures (
  jobId, captureMode, domain, extractor, url, title, pageTimestamp, receivedAt,
  fileName, productCount, debugJson, text, html, rawJson
)
OUTPUT INSERTED.id
VALUES (
  @jobId, @captureMode, @domain, @extractor, @url, @title, @pageTimestamp, @receivedAt,
  @fileName, @productCount, @debugJson, @text, @html, @rawJson
);
`);

    const captureId = captureResult.recordset[0].id;

    for (const product of capture.products) {
      const productRequest = new sql.Request(transaction);
      inputNullable(productRequest, "captureId", sql.Int, captureId);
      inputNullable(productRequest, "name", sql.NVarChar(1000), product.name);
      inputNullable(productRequest, "price", sql.NVarChar(255), product.price);
      inputNullable(productRequest, "oldPrice", sql.NVarChar(255), product.oldPrice);
      inputNullable(productRequest, "image", sql.NVarChar(2000), product.image);
      inputNullable(productRequest, "link", sql.NVarChar(2000), product.link);
      inputNullable(productRequest, "sku", sql.NVarChar(255), product.sku);
      inputNullable(productRequest, "rawText", sql.NVarChar(sql.MAX), product.rawText);
      inputNullable(productRequest, "rawJson", sql.NVarChar(sql.MAX), JSON.stringify(product));

      await productRequest.query(`
INSERT INTO dbo.ScrapeProducts (
  captureId, name, price, oldPrice, image, link, sku, rawText, rawJson
)
VALUES (
  @captureId, @name, @price, @oldPrice, @image, @link, @sku, @rawText, @rawJson
);
`);
    }

    await transaction.commit();
    return { captureId, productsInserted: capture.products.length };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

async function checkDbHealth() {
  const pool = await getPool();
  const result = await pool.request().query("SELECT 1 AS ok;");
  return result.recordset[0];
}

module.exports = {
  checkDbHealth,
  saveCaptureToDb
};
