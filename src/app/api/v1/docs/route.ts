export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Single-page API reference rendered by Scalar over the OpenAPI spec.
// Loaded from CDN so we don't carry the asset weight in the bundle. Anyone
// who can reach this URL can read the schema; the API itself still requires
// a Bearer key.
export async function GET() {
  const html = `<!DOCTYPE html>
<html>
  <head>
    <title>iLeads QMS API</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script
      id="api-reference"
      data-url="../openapi.json"
      data-configuration='{"theme":"default","hideDownloadButton":false}'
    ></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`;
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
