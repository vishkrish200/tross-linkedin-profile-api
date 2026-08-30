import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildOpenApiDocument } from "../src/api-documentation.js";

const temporaryDirectory = await mkdtemp(join(tmpdir(), "tross-openapi-"));
const specifications = [
  {
    name: "bearer.json",
    document: buildOpenApiDocument({ mode: "bearer" }),
  },
  {
    name: "public-demo.json",
    document: buildOpenApiDocument({
      mode: "public-demo",
      expiresAt: "2099-12-31T23:59:59.000Z",
      perClientMax: 120,
      globalMax: 180,
      timeWindow: "1 minute",
      maxColdExtractions: 100,
      maxQueuedDistinctProfiles: 4,
    }),
  },
];

try {
  const paths = await Promise.all(specifications.map(async ({ name, document }) => {
    const path = join(temporaryDirectory, name);
    await writeFile(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    return path;
  }));

  const executable = process.platform === "win32" ? "redocly.cmd" : "redocly";
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(executable, ["lint", ...paths], { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) throw new Error(`OpenAPI lint failed with exit code ${exitCode}`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
