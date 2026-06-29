# Fahorro DOM Extractor

Proyecto local de web scraping tipo RPA/local browser. No usa Playwright, Puppeteer, Selenium ni automatizacion de navegador. Usa Chrome normal, una extension Manifest V3 y un backend local Express para guardar el DOM renderizado.

## Estructura

```text
scraper-fahorro/
  package.json
  app.js
  captures/
  extension/
    extractors/
      utils.js
      default.js
      fahorro.js
      bodegaaurrera.js
      soriana.js
      merco.js
      farmaciasguadalajara.js
    manifest.json
    background.js
    content.js
  README.md
```

## Requisitos

- Node.js instalado.
- Google Chrome instalado en Windows.

## Instalar dependencias

Desde la carpeta del proyecto:

```powershell
cd scraper-fahorro
npm install
```

## Iniciar servidor

```powershell
npm start
```

El backend queda disponible en:

```text
http://localhost:3005
```

Verificacion rapida:

```powershell
curl http://localhost:3005/health
```

Debe responder:

```json
{ "ok": true }
```

## Cargar la extension en Chrome

1. Abrir `chrome://extensions`.
2. Activar `Modo desarrollador`.
3. Hacer clic en `Cargar descomprimida`.
4. Seleccionar la carpeta `scraper-fahorro/extension`.

## Probar captura

1. Ejecutar el servidor con `npm start`.
2. Abrir esta URL en Chrome:

```text
https://www.fahorro.com/farmacia.html?page=1
```

Tambien puedes intentar abrirla desde el backend:

```powershell
curl "http://localhost:3005/open?url=https%3A%2F%2Fwww.fahorro.com%2Ffarmacia.html%3Fpage%3D1"
```

3. Esperar a que cargue la pagina.
4. Dar clic al icono de la extension `Fahorro DOM Extractor`.
5. Revisar la carpeta `captures`.

## Probar captura automatica

Con el backend corriendo y la extension cargada en Chrome, puedes lanzar una captura desde el endpoint:

```powershell
curl "http://localhost:3005/scrape?url=https%3A%2F%2Fwww.fahorro.com%2Ffarmacia.html%3Fpage%3D1"
```

Para Bodega Aurrera:

```powershell
curl "http://localhost:3005/scrape?url=https%3A%2F%2Fdespensa.bodegaaurrera.com.mx%2Fcontent%2Farticulos-bebes-y-ninos%2F02"
```

Bodega Aurrera activa paginacion automatica por default. Si una categoria tiene mas paginas, la extension captura la pagina actual y navega a `&page=2`, `&page=3`, etc. Puedes controlar el maximo:

```powershell
curl "http://localhost:3005/scrape?url=https%3A%2F%2Fdespensa.bodegaaurrera.com.mx%2Fcontent%2Farticulos-bebes-y-ninos%2F02&autoPaginate=true&maxPages=5"
```

## Setear tienda Bodega Aurrera sin scrapear

Este endpoint abre Chrome y ejecuta un flujo RPA separado para seleccionar tienda en Bodega Aurrera. No guarda JSON, no guarda SQL y no extrae productos.

Por defecto usa el codigo postal `67350` y la tienda `Allende Zuazua`:

```powershell
curl "http://localhost:3005/bodega/set-store?url=https%3A%2F%2Fdespensa.bodegaaurrera.com.mx%2Fcontent%2Fdetergente-suavizante-y-limpieza-del-hogar%2F13"
```

Tambien puedes mandarlo explicito. Usa `storeName` para seleccionar una tienda especifica:

```powershell
curl "http://localhost:3005/bodega/set-store?url=https%3A%2F%2Fdespensa.bodegaaurrera.com.mx%2Fcontent%2Fdetergente-suavizante-y-limpieza-del-hogar%2F13&zipCode=67350&storeName=Allende%20Zuazua"
```

El flujo hace esto:

1. Abre la URL en Chrome.
2. Busca la zona `Elige como quieres recibir el pedido`.
3. Evita el boton `Agregar direccion`.
4. Abre el selector de tienda actual dentro del panel.
5. En la ventana lateral `Elegir tienda`, escribe el codigo postal.
6. Selecciona la tienda indicada por `storeName`.

Por default deja la pestana abierta para revisar visualmente el resultado. Si quieres cerrarla al terminar:

```powershell
curl "http://localhost:3005/bodega/set-store?url=https%3A%2F%2Fdespensa.bodegaaurrera.com.mx%2Fcontent%2Fdetergente-suavizante-y-limpieza-del-hogar%2F13&zipCode=67350&storeName=Allende%20Zuazua&closeTab=true"
```

Para Soriana:

```powershell
curl "http://localhost:3005/scrape?url=https%3A%2F%2Fwww.soriana.com%2Fdespensa%2Fbotanas-y-tostadas%2Fpapas-y-frituras%2F%3Fcgid%3Dbotanas-y-tostadas%26srule%3Dpapas-y-frituras%26start%3D0%26sz%3D200%26pageNumber%3D1%26forceOldView%3Dtrue%26view%3Dgrid%26cref%3D0"
```

Para Merco con scroll automatico:

```powershell
curl "http://localhost:3005/scrape?url=https%3A%2F%2Fadomicilio.merco.mx%2Fc%2Fbebes-d5g3znm5xj&autoScroll=true&waitBeforeCaptureMs=5000&maxScrolls=25"
```

Para Farmacias Guadalajara con boton `Ver mas productos`:

```powershell
curl "http://localhost:3005/scrape?url=https%3A%2F%2Fwww.farmaciasguadalajara.com%2Fsuper%2Fbebes%2Fformulas-infantiles&autoScroll=true&clickLoadMore=true&waitBeforeCaptureMs=5000&maxLoadMoreClicks=10"
```

El backend hace esto:

1. Registra un job pendiente para esa URL.
2. Abre Chrome con la URL recibida.
3. La extension detecta que la pagina abierta tiene un job pendiente.
4. Espera unos segundos a que carguen componentes/productos.
5. Ejecuta la misma extraccion del DOM renderizado.
6. Guarda el JSON en `captures`.

Puedes revisar jobs recientes con:

```powershell
curl http://localhost:3005/scrape-jobs
```

El clic en el icono de la extension sigue funcionando como captura manual.

## Ejecutar URLs activas desde SQL Server

El endpoint lee URLs activas desde SQL Server:

```sql
SELECT strUrl
FROM Urls_Scrapp
WHERE estatus = 1;
```

Ejecuta scraping para cada URL activa:

```powershell
curl http://localhost:3005/scrape-active-urls
```

Por defecto este endpoint usa `saveDb=true`, crea un job por URL y abre cada URL en Chrome con una pausa de 1.5 segundos entre tabs.
Al terminar cada scrape automatico, la extension cierra la pestaña. Puedes evitarlo con `closeTab=false`.

Parametros utiles:

```powershell
curl "http://localhost:3005/scrape-active-urls?limit=5&openDelayMs=2500"
```

- `limit`: maximo de URLs a lanzar.
- `openDelayMs`: espera entre abrir una URL y la siguiente.
- `saveDb=false`: desactiva guardado en SQL Server.
- `closeTab=false`: deja abiertas las pestañas al terminar.
- Tambien acepta los mismos parametros de `/scrape`, como `waitBeforeCaptureMs`, `autoScroll`, `autoPaginate`, `clickLoadMore`, `maxScrolls`, `maxPages` y `maxLoadMoreClicks`.

El backend infiere algunos defaults por dominio:

- `adomicilio.merco.mx`: activa `autoScroll`.
- `farmaciasguadalajara.com`: activa `autoScroll` y `clickLoadMore`.

Si necesitas configuracion por URL, lo mas limpio es extender `Urls_Scrapp` o crear un SP que devuelva columnas como `strUrl`, `extractor`, `autoScroll`, `clickLoadMore`, `waitBeforeCaptureMs`, `maxScrolls`, `maxLoadMoreClicks` y `saveDb`.

## Guardar tambien en SQL Server

Por defecto siempre se guarda JSON en `captures`. Si quieres guardar tambien en SQL Server, edita `scraper-fahorro/.env`.

Hay dos perfiles listos, ambos con usuario/password de SQL Server:

- `local`: SQL Server local con usuario SQL.
- `vps`: SQL Server remoto con usuario/password SQL.

Selecciona el perfil activo con:

```powershell
SQLSERVER_PROFILE=local
```

Para VPS usa:

```powershell
SQLSERVER_PROFILE=vps
```

El perfil local usa:

```text
SQLSERVER_LOCAL_AUTH=sql
SQLSERVER_LOCAL_HOST=localhost
SQLSERVER_LOCAL_DATABASE=ScraperDb
SQLSERVER_LOCAL_USER=sa
SQLSERVER_LOCAL_PASSWORD=your_local_sql_password
```

El perfil VPS usa:

```text
SQLSERVER_VPS_AUTH=sql
SQLSERVER_VPS_HOST=your-vps-host-or-ip
SQLSERVER_VPS_DATABASE=ScraperDb
SQLSERVER_VPS_USER=your_sql_user
SQLSERVER_VPS_PASSWORD=your_sql_password
```

Valida la conexion:

```powershell
curl http://localhost:3005/db/health
```

Consulta la comparativa desde el SP `GetComparativa`:

```powershell
curl http://localhost:3005/comparativa
```

Respuesta:

```json
{
  "ok": true,
  "count": 10,
  "data": []
}
```

## Matching por descripcion

Este endpoint cruza `com_articulos.descripcion` contra `ScrapeProducts.name` y propone equivalencias entre `com_articulos.codigo` y `ScrapeProducts.sku`.

Primero crea esta tabla manualmente en SQL Server:

```sql
CREATE TABLE dbo.ScrapeProductEquivalences (
    id INT IDENTITY(1,1) PRIMARY KEY,
    artc_articulo NVARCHAR(255) NOT NULL,
    artc_descripcion NVARCHAR(1000) NOT NULL,
    scrapeProductId INT NOT NULL,
    scrapeSku NVARCHAR(255) NOT NULL,
    scrapeName NVARCHAR(1000) NULL,
    scrapeLink NVARCHAR(2000) NULL,
    scrapeDomain NVARCHAR(255) NULL,
    matchScore DECIMAL(5,2) NOT NULL,
    matchMethod NVARCHAR(50) NOT NULL,
    status NVARCHAR(30) NOT NULL CONSTRAINT DF_ScrapeProductEquivalences_status DEFAULT 'pending',
    createdAt DATETIME2 NOT NULL CONSTRAINT DF_ScrapeProductEquivalences_createdAt DEFAULT SYSUTCDATETIME(),
    updatedAt DATETIME2 NULL
);

CREATE UNIQUE INDEX UX_ScrapeProductEquivalences_articulo_sku
ON dbo.ScrapeProductEquivalences (artc_articulo, scrapeSku);

CREATE INDEX IX_ScrapeProductEquivalences_status_score
ON dbo.ScrapeProductEquivalences (status, matchScore DESC);
```

Preview sin guardar:

```powershell
curl "http://localhost:3005/match-description-equivalences?minScore=70&limit=100&requestTimeoutMs=120000"
```

Obtener el SQL de preview sin ejecutarlo:

```powershell
curl "http://localhost:3005/match-description-equivalences/sql?minScore=70&limit=100"
```

Guardar equivalencias:

```powershell
curl "http://localhost:3005/match-description-equivalences?minScore=70&limit=500&requestTimeoutMs=120000&save=true"
```

Obtener el SQL de guardado sin ejecutarlo:

```powershell
curl "http://localhost:3005/match-description-equivalences/sql?minScore=70&limit=500&save=true"
```

Parametros:

- `minScore`: score minimo de coincidencia, default `70`.
- `limit`: maximo de equivalencias a evaluar/guardar, default `500`.
- `requestTimeoutMs`: timeout SQL para esta operacion, default `120000`.
- `save=true`: ejecuta `MERGE` sobre `dbo.ScrapeProductEquivalences`.
- `printSql=true`: devuelve el SQL dentro de JSON sin ejecutarlo.

Las coincidencias quedan con `status = 'pending'` para que puedas revisarlas antes de tomarlas como definitivas. La fuente se lee desde `com_articulos.codigo` y `com_articulos.descripcion`, pero se guarda en `ScrapeProductEquivalences.artc_articulo` y `ScrapeProductEquivalences.artc_descripcion` para respetar la tabla existente. La metrica actual usa coincidencia exacta, contencion de texto y solapamiento de tokens.

Para lanzar una captura y guardar en JSON + SQL Server agrega `saveDb=true`:

```powershell
curl "http://localhost:3005/scrape?url=https%3A%2F%2Fwww.fahorro.com%2Ffarmacia.html%3Fpage%3D1&saveDb=true"
```

Tambien funciona con los otros parametros:

```powershell
curl "http://localhost:3005/scrape?url=https%3A%2F%2Fwww.soriana.com%2Fdespensa%2Fbotanas-y-tostadas%2Fpapas-y-frituras%2F%3Fcgid%3Dbotanas-y-tostadas%26srule%3Dpapas-y-frituras%26start%3D0%26sz%3D200%26pageNumber%3D1%26forceOldView%3Dtrue%26view%3Dgrid%26cref%3D0&waitBeforeCaptureMs=10000&saveDb=true"
```

El backend crea automaticamente estas tablas si no existen:

- `dbo.ScrapeCaptures`
- `dbo.ScrapeProducts`

Si falla SQL Server, el JSON se guarda de todos modos y la respuesta incluye `db.saved: false` con el error.

## Extractores por dominio

La extension usa una arquitectura modular para escalar a otros sitios:

```text
extension/extractors/
  utils.js
  default.js
  fahorro.js
  bodegaaurrera.js
  soriana.js
  merco.js
  farmaciasguadalajara.js
```

Actualmente hay extractores listos para:

- `fahorro`: `fahorro.com`, `www.fahorro.com`
- `bodegaaurrera`: `bodegaaurrera.com.mx`, `www.bodegaaurrera.com.mx`, `despensa.bodegaaurrera.com.mx`
- `soriana`: `soriana.com`, `www.soriana.com`
- `merco`: `merco.mx`, `www.merco.mx`, `adomicilio.merco.mx`
- `farmaciasguadalajara`: `farmaciasguadalajara.com`, `www.farmaciasguadalajara.com`
- `default`: fallback generico para dominios sin extractor dedicado

La seleccion normalmente es automatica por dominio. Si quieres forzar un extractor especifico:

```powershell
curl "http://localhost:3005/scrape?url=https%3A%2F%2Fwww.fahorro.com%2Ffarmacia.html%3Fpage%3D1&extractor=fahorro"
```

Tambien puedes ajustar la espera antes de capturar:

```powershell
curl "http://localhost:3005/scrape?url=https%3A%2F%2Fdespensa.bodegaaurrera.com.mx%2Fcontent%2Farticulos-bebes-y-ninos%2F02&waitBeforeCaptureMs=8000"
```

Para sitios que cargan mas productos al hacer scroll, usa:

```powershell
curl "http://localhost:3005/scrape?url=https%3A%2F%2Fadomicilio.merco.mx%2Fc%2Fbebes-d5g3znm5xj&autoScroll=true&scrollStepPx=900&scrollDelayMs=900&maxScrolls=25"
```

Parametros de scroll:

- `autoScroll=true`: activa scroll antes de capturar.
- `scrollStepPx`: pixeles por paso de scroll.
- `scrollDelayMs`: espera entre pasos.
- `maxScrolls`: maximo de pasos.

Parametros para botones de carga:

- `clickLoadMore=true`: busca y presiona botones/enlaces por texto.
- `loadMoreText`: texto del boton. Por defecto `Ver más productos`.
- `maxLoadMoreClicks`: maximo de clics.
- `loadMoreDelayMs`: espera despues de cada clic.

Parametros de paginacion:

- `autoPaginate=true`: captura paginas consecutivas cuando detecta paginacion.
- `maxPages`: maximo de paginas a recorrer.
- `paginationDelayMs`: espera antes de navegar a la siguiente pagina.

Cada captura incluye `domain`, `extractor` y `debug.selectedExtractor` para saber que ruta de extraccion se uso.

Cada captura se guarda como:

```text
captures/capture-YYYYMMDD-HHmmss.json
```

## Datos capturados

La extension lee el DOM renderizado de la pestana abierta y envia a:

```text
POST http://localhost:3005/capture
```

El JSON incluye:

- `url`
- `title`
- `timestamp`
- `text`
- `html`
- `products`
- `debug.totalProductCandidates`
- `debug.totalProductsExtracted`

Cada producto intenta incluir:

- `name`
- `price`
- `oldPrice`
- `image`
- `link`
- `sku`
- `rawText`

La extraccion de productos es flexible. Busca candidatos con clases que contengan `product`, atributos como `data-product-id`, microdatos `itemtype` con `Product`, y contenedores tipo card/list item que parezcan tener nombre y precio.

## Troubleshooting

- Si `fetch` falla, verifica que el servidor este corriendo con `npm start`.
- Si no extrae productos, abre el JSON guardado y revisa `debug.totalProductCandidates`, `debug.totalProductsExtracted`, `text` y `html`; despues ajusta selectores en `extension/content.js`.
- Si Chrome bloquea CORS, confirma que el backend sigue usando `cors()` en `app.js`.
- Si no funciona en `chrome://`, `edge://` u otras paginas internas, es normal: Chrome no permite content scripts en paginas internas del navegador.
- Si `/open` no abre Chrome, confirma que Chrome esta instalado y disponible en el PATH de Windows. Tambien puedes abrir la URL manualmente en Chrome.
- Si `/scrape` abre Chrome pero no guarda JSON, recarga la extension en `chrome://extensions` y confirma que la URL abierta sea exactamente la misma que enviaste al endpoint.
- Si agregas o modificas extractores, recarga la extension desde `chrome://extensions` antes de probar.
- Si `saveDb=true` no guarda en SQL Server, revisa `curl http://localhost:3005/db/health` y confirma las variables `SQLSERVER_*`.
- Si una pagina como Merco trae pocos productos, sube `maxScrolls` o `scrollDelayMs` para dar mas tiempo a la carga progresiva.
- Si Farmacias Guadalajara trae pocos productos, sube `maxLoadMoreClicks` o `loadMoreDelayMs`.

## Comandos Windows

```powershell
cd C:\Users\User\Documents\GitHub\automate_mvp\scraper-fahorro
npm install
npm start
```

Despues carga la extension desde:

```text
C:\Users\User\Documents\GitHub\automate_mvp\scraper-fahorro\extension
```
