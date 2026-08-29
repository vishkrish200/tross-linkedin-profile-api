import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { buildLoggerOptions } from "../src/logging.js";

describe("privacy-safe logging", () => {
  it("redacts credentials, request bodies, and extracted response bodies", async () => {
    const lines: string[] = [];
    const app = await buildApp({
      provider: { fetch: async () => { throw new Error("not called"); } },
      logger: buildLoggerOptions("info", { write: (line) => { lines.push(line); } }),
    });

    app.log.info({
      req: { headers: { authorization: "Bearer caller-secret", cookie: "li_at=session-secret" } },
      body: { url: "https://www.linkedin.com/in/private-slug/" },
      response: { about: "private biography text" },
    }, "redaction probe");
    await app.close();

    const output = lines.join("");
    expect(output).toContain("[REDACTED]");
    expect(output).not.toContain("caller-secret");
    expect(output).not.toContain("session-secret");
    expect(output).not.toContain("private-slug");
    expect(output).not.toContain("private biography text");
  });
});
