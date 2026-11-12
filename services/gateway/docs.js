const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yaml');

const SPEC_PATH = path.join(__dirname, '../../docs/openapi.yaml');

// Serves the OpenAPI spec as JSON and as an interactive Swagger UI page
function docsRouter() {
  const spec = YAML.parse(fs.readFileSync(SPEC_PATH, 'utf8'));
  const router = express.Router();

  router.get('/openapi.json', (_req, res) => res.json(spec));
  router.use(
    '/',
    swaggerUi.serve,
    swaggerUi.setup(spec, {
      customSiteTitle: 'Fleet Management API Docs',
      swaggerOptions: { persistAuthorization: true }, // keep the API key after page reload
    }),
  );

  return router;
}

module.exports = docsRouter;
