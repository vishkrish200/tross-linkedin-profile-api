import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execute = promisify(execFile);
const profileUrl = "https://www.linkedin.com/in/synthetic-example/";

async function runMatrix(body: string, status = 200, cases = 1) {
  const directory = await mkdtemp(join(tmpdir(), "tross-matrix-test-"));
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    response.writeHead(status, { "content-type": "application/json" }).end(body);
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server failed to bind");
    const matrixFile = join(directory, "matrix.json");
    await writeFile(matrixFile, JSON.stringify(Array.from({ length: cases }, (_, index) => ({
      case: index + 1,
      url: index === 0 ? profileUrl : `${profileUrl.slice(0, -1)}-${index}/`,
    }))));
    const output = await execute(process.execPath, ["--import", "tsx", "scripts/smoke-matrix.ts"], {
      env: {
        PATH: process.env.PATH,
        PROFILE_MATRIX_FILE: matrixFile,
        PROFILE_API_URL: `http://127.0.0.1:${address.port}/v1/profiles`,
      },
      timeout: 5_000,
    }).then((result) => ({ ...result, code: 0 }), (error: { stdout: string; stderr: string; code: number }) => error);
    return { ...output, requests };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}

describe("private live-matrix runner", () => {
  it("reports schema-valid structural evidence without profile content", async () => {
    const result = await runMatrix(JSON.stringify({ data: {
      sourceUrl: profileUrl,
      fetchedAt: "2026-08-31T00:00:00.000Z",
      name: "Synthetic Private Name",
      about: "Synthetic private biography",
      experience: [],
      education: [],
      skills: [],
      certifications: [],
      languages: [],
      profileImages: [],
      warnings: [],
    } }));
    expect(result.code).toBe(0);
    expect(result.requests).toBe(1);
    expect(result.stdout).toContain('"passed":1');
    expect(result.stdout).not.toMatch(/Synthetic|synthetic-example/);
  });

  it.each([
    [404, '{"error":"profile_unavailable"}', "profile_unavailable"],
    [502, '{"error":"provider_authentication_failed"}', "provider_authentication_failed"],
    [200, '{"data":{}}', "invalid_response_contract"],
    [502, "<html>private upstream response</html>", "invalid_json_response"],
  ])("stops the matrix on HTTP %i and a failed response", async (status, body, error) => {
    const result = await runMatrix(body, status, 2);
    expect(result.code).toBe(1);
    expect(result.requests).toBe(1);
    expect(result.stdout).toContain(error);
    expect(result.stdout).toContain(`"status":${status}`);
    expect(result.stdout).toContain('"stopped":true');
    expect(result.stdout).toContain('"total":2,"attempted":1,"passed":0');
    expect(result.stdout).not.toContain("private upstream response");
  });
});
