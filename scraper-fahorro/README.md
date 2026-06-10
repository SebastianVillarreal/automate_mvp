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

Para Soriana:

```powershell
curl "http://localhost:3005/scrape?url=https%3A%2F%2Fwww.soriana.com%2Fdespensa%2Fbotanas-y-tostadas%2Fpapas-y-frituras%2F%3Fcgid%3Dbotanas-y-tostadas%26srule%3Dpapas-y-frituras%26start%3D0%26sz%3D200%26pageNumber%3D1%26forceOldView%3Dtrue%26view%3Dgrid%26cref%3D0"
```

Para Merco con scroll automatico:

```powershell
curl "http://localhost:3005/scrape?url=https%3A%2F%2Fadomicilio.merco.mx%2Fc%2Fbebes-d5g3znm5xj&autoScroll=true&waitBeforeCaptureMs=5000&maxScrolls=25"
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

## Guardar tambien en SQL Server

Por defecto siempre se guarda JSON en `captures`. Si quieres guardar tambien en SQL Server, configura estas variables de entorno antes de iniciar el backend:

```powershell
$env:SQLSERVER_HOST="localhost"
$env:SQLSERVER_PORT="1433"
$env:SQLSERVER_DATABASE="ScraperDb"
$env:SQLSERVER_USER="sa"
$env:SQLSERVER_PASSWORD="tu_password"
$env:SQLSERVER_ENCRYPT="false"
$env:SQLSERVER_TRUST_CERT="true"
npm start
```

Valida la conexion:

```powershell
curl http://localhost:3005/db/health
```

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
```

Actualmente hay extractores listos para:

- `fahorro`: `fahorro.com`, `www.fahorro.com`
- `bodegaaurrera`: `bodegaaurrera.com.mx`, `www.bodegaaurrera.com.mx`, `despensa.bodegaaurrera.com.mx`
- `soriana`: `soriana.com`, `www.soriana.com`
- `merco`: `merco.mx`, `www.merco.mx`, `adomicilio.merco.mx`
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
