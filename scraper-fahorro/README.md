# Fahorro DOM Extractor

Proyecto local de web scraping tipo RPA/local browser. No usa Playwright, Puppeteer, Selenium ni automatizacion de navegador. Usa Chrome normal, una extension Manifest V3 y un backend local Express para guardar el DOM renderizado.

## Estructura

```text
scraper-fahorro/
  package.json
  app.js
  captures/
  extension/
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
