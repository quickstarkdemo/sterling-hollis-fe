import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_OPENAPI_URL = "https://raw.githubusercontent.com/quickstarkdemo/sterling-hollis-be/main/docs/openapi.json";
const OUTPUT_PATH = path.resolve("src/contracts/backendCapabilityManifest.json");
const FRONTEND_SURFACES = new Set([
  "catalog_admin",
  "developer_trace",
  "operator_compatibility",
  "public_shopper",
]);

function operationEntries(spec) {
  const entries = [];
  for (const [operationPath, methods] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(methods || {})) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      const surface = operation["x-sterling-api-surface"];
      const capabilityId = operation["x-sterling-capability-id"];
      if (!FRONTEND_SURFACES.has(surface) || !capabilityId) continue;
      entries.push({
        method: method.toUpperCase(),
        pathTemplate: operationPath,
        capabilityId,
        surface,
        contractStatus: operation["x-sterling-contract-status"] || "unknown",
        currentFrontendContract: Boolean(operation["x-sterling-current-frontend-contract"]),
        legacyCompatibility: Boolean(operation["x-sterling-legacy-compatibility"]),
        migrationTarget: operation["x-sterling-migration-target"] || null,
        adminGeneration: operation["x-sterling-admin-generation"] || null,
        authPosture: operation["x-sterling-auth-posture"] || null,
      });
    }
  }
  return entries.sort((left, right) => (
    `${left.pathTemplate} ${left.method}`.localeCompare(`${right.pathTemplate} ${right.method}`)
  ));
}

const source = process.env.BACKEND_OPENAPI_URL || DEFAULT_OPENAPI_URL;
const response = await fetch(source);
if (!response.ok) {
  throw new Error(`Unable to fetch backend OpenAPI from ${source}: ${response.status}`);
}

const spec = await response.json();
const manifest = {
  source,
  generatedFrom: "quickstarkdemo/sterling-hollis-be docs/openapi.json",
  refreshedAt: new Date().toISOString(),
  operations: operationEntries(spec),
};

await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${manifest.operations.length} capability operations to ${OUTPUT_PATH}`);
