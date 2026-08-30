import { z } from "zod";
import {
  profileRequestSchema,
  profileSchema,
} from "./domain/profile.js";

export const publicRepositoryUrl = "https://github.com/vishkrish200/tross-linkedin-profile-api";
export const publicApiUrl = "https://tross-linkedin-profile-api-583248531894.asia-south1.run.app";

export type ApiAccessDescription =
  | { mode: "bearer" }
  | {
      mode: "public-demo";
      expiresAt?: string;
      perClientMax: number;
      globalMax: number;
      timeWindow: string;
      maxColdExtractions: number;
      maxQueuedDistinctProfiles: number;
    };

function jsonSchema(schema: z.ZodType) {
  const { $schema: _schemaDialect, ...document } = z.toJSONSchema(schema);
  return document;
}

export function buildOpenApiDocument(access: ApiAccessDescription) {
  const bearerProtected = access.mode === "bearer";
  return {
  openapi: "3.1.0",
  info: {
    title: "LinkedIn Profile API",
    version: "1.0.0",
    description:
      "Browser-free LinkedIn profile extraction through direct HTTP and React Flight/RSC contracts.",
    license: {
      name: "MIT",
      identifier: "MIT",
    },
  },
  servers: [{ url: publicApiUrl }],
  tags: [
    { name: "Discovery", description: "Public service metadata and health." },
    {
      name: "Profiles",
      description: bearerProtected
        ? "Authenticated profile extraction."
        : "Controlled public-demo profile extraction.",
    },
  ],
  paths: {
    "/": {
      get: {
        tags: ["Discovery"],
        summary: "Discover the API",
        operationId: "discoverApi",
        security: [],
        responses: {
          "200": {
            description: "Service metadata and endpoint links.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Discovery" },
              },
            },
          },
        },
      },
    },
    "/health": {
      get: {
        tags: ["Discovery"],
        summary: "Check service health",
        operationId: "getHealth",
        security: [],
        responses: {
          "200": {
            description: "The HTTP service is ready.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["status"],
                  properties: { status: { type: "string", const: "ok" } },
                },
              },
            },
          },
        },
      },
    },
    "/v1/profiles": {
      post: {
        tags: ["Profiles"],
        summary: "Extract a LinkedIn profile",
        description:
          "Returns profile information visible to the configured authorized LinkedIn session. The service does not retry or bypass authentication, checkpoint, CAPTCHA, 429, or 999 signals.",
        operationId: "extractLinkedInProfile",
        security: bearerProtected ? [{ bearerAuth: [] }] : [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ProfileRequest" },
              example: { url: "https://www.linkedin.com/in/example-person/" },
            },
          },
        },
        responses: {
          "200": {
            description: "Structured profile data.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ProfileResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/InvalidRequest" },
          ...(bearerProtected ? { "401": { $ref: "#/components/responses/Unauthorized" } } : {}),
          "404": { $ref: "#/components/responses/ProfileUnavailable" },
          ...(!bearerProtected ? { "410": { $ref: "#/components/responses/DemoClosed" } } : {}),
          "413": { $ref: "#/components/responses/PayloadTooLarge" },
          "415": { $ref: "#/components/responses/UnsupportedMediaType" },
          "429": { $ref: "#/components/responses/RateLimited" },
          "500": { $ref: "#/components/responses/InternalError" },
          "502": { $ref: "#/components/responses/ProviderFailure" },
          "503": { $ref: "#/components/responses/ProviderNotConfigured" },
        },
      },
    },
  },
  components: {
    ...(bearerProtected ? {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "A separately provisioned API bearer token.",
        },
      },
    } : {}),
    schemas: {
      Discovery: {
        type: "object",
        required: ["name", "status", "revision", "runtime", "endpoints", "access", "source"],
        properties: {
          name: { type: "string", example: "LinkedIn Profile API" },
          status: { type: "string", const: "ok" },
          revision: { type: "string", example: "tross-linkedin-profile-api-00010-ab1" },
          runtime: { type: "string", example: "Direct LinkedIn HTTP/RSC; no browser" },
          endpoints: {
            type: "object",
            additionalProperties: { type: "string" },
          },
          access: bearerProtected
            ? {
                type: "object",
                additionalProperties: false,
                required: ["mode"],
                properties: { mode: { type: "string", const: "bearer" } },
              }
            : {
                type: "object",
                additionalProperties: false,
                required: [
                  "mode",
                  "perClientMax",
                  "globalMax",
                  "timeWindow",
                  "maxColdExtractions",
                  "maxQueuedDistinctProfiles",
                ],
                properties: {
                  mode: { type: "string", const: "public-demo" },
                  expiresAt: { type: "string", format: "date-time" },
                  perClientMax: { type: "integer", minimum: 1 },
                  globalMax: { type: "integer", minimum: 1 },
                  timeWindow: { type: "string" },
                  maxColdExtractions: { type: "integer", minimum: 1 },
                  maxQueuedDistinctProfiles: { type: "integer", minimum: 0 },
                },
              },
          source: { type: "string", format: "uri" },
        },
      },
      ProfileRequest: jsonSchema(profileRequestSchema),
      ProfileResponse: {
        type: "object",
        additionalProperties: false,
        required: ["data"],
        properties: { data: { $ref: "#/components/schemas/Profile" } },
      },
      Profile: jsonSchema(profileSchema),
      Error: {
        type: "object",
        additionalProperties: false,
        required: ["error", "message"],
        properties: {
          error: { type: "string" },
          message: { type: "string" },
        },
      },
    },
    responses: {
      InvalidRequest: {
        description: "Malformed body or unsupported profile URL.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      ...(bearerProtected ? {
        Unauthorized: {
          description: "The bearer token is missing or invalid.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
      } : {
        DemoClosed: {
          description: "The controlled public evaluation window has ended.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
      }),
      PayloadTooLarge: {
        description: "The request body exceeds the configured size limit.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      UnsupportedMediaType: {
        description: "The request Content-Type is not JSON.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      RateLimited: {
        description: "The caller quota has been exceeded.",
        headers: {
          "Retry-After": { schema: { type: "integer" } },
        },
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      ProfileUnavailable: {
        description: "The LinkedIn profile is unavailable to the configured session.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      ProviderFailure: {
        description: "LinkedIn authentication, protection, transport, or response-contract failure.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      ProviderNotConfigured: {
        description: "Required LinkedIn runtime secrets are absent.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      InternalError: {
        description: "An unexpected internal error occurred.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
    },
  },
  } as const;
}

const profileResponseExample = `{
  "data": {
    "sourceUrl": "https://www.linkedin.com/in/example-person/",
    "fetchedAt": "2026-08-29T00:00:00.000Z",
    "name": "Example Person",
    "headline": "Software Engineer",
    "location": "Bengaluru, India",
    "experience": [],
    "education": [],
    "skills": [],
    "certifications": [],
    "languages": [],
    "profileImages": [],
    "warnings": []
  }
}`;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

export function buildApiDocumentationHtml(access: ApiAccessDescription): string {
  const bearerProtected = access.mode === "bearer";
  const authenticationLabel = bearerProtected ? "Bearer token" : "Controlled public demo";
  const requestDescription = bearerProtected
    ? "Accepts one canonical LinkedIn profile URL. A bearer token is required."
    : `Accepts one canonical LinkedIn profile URL without a caller token. Public access is limited to ${access.perClientMax} requests per client and ${access.globalMax} requests globally per ${escapeHtml(access.timeWindow)}. Cache hits and simultaneous requests for the same profile share work; at most ${access.maxQueuedDistinctProfiles} distinct uncached profiles wait behind active extraction.`;
  const authorizationHeader = bearerProtected
    ? [' \\', '  -H "authorization: Bearer $API_KEY"'].join("\n")
    : "";
  const expiryLine = !bearerProtected && access.expiresAt
    ? `<p class="note"><strong>Evaluation window:</strong> public access closes automatically at ${escapeHtml(access.expiresAt)}. The process allows at most ${access.maxColdExtractions} uncached profile extractions before restart.</p>`
    : "";
  const accessFailureRow = bearerProtected
    ? "<tr><td><code>401</code></td><td>Missing or invalid API bearer token.</td></tr>"
    : "<tr><td><code>410</code></td><td>The controlled public evaluation window has ended.</td></tr>";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Browser-free LinkedIn Profile API documentation">
  <title>LinkedIn Profile API</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #17191b;
      --muted: #67625d;
      --paper: #f7f4ef;
      --surface: #fffdf9;
      --line: #d9d2c8;
      --accent: #e85323;
      --code: #202326;
    }
    * { box-sizing: border-box; }
    html { max-width: 100%; overflow-x: hidden; scroll-behavior: smooth; }
    body {
      margin: 0;
      max-width: 100%;
      overflow-x: hidden;
      color: var(--ink);
      background: var(--paper);
      font-family: "SF Pro Display", "Helvetica Neue", Arial, sans-serif;
      line-height: 1.55;
    }
    a { color: inherit; text-decoration-color: var(--accent); text-underline-offset: 4px; }
    a:hover { color: var(--accent); }
    .shell { width: min(1180px, calc(100% - 40px)); margin: 0 auto; }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 72px;
      border-bottom: 1px solid var(--line);
    }
    .brand { display: flex; align-items: center; gap: 11px; font-weight: 680; letter-spacing: -0.02em; }
    .mark { width: 24px; height: 8px; background: var(--accent); transform: skewX(-28deg); }
    nav { display: flex; gap: 22px; font-size: 14px; }
    main { padding: 74px 0 96px; }
    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1.35fr) minmax(270px, 0.65fr);
      gap: clamp(44px, 9vw, 128px);
      align-items: end;
      padding-bottom: 72px;
    }
    .eyebrow, .method, .label {
      font-family: ui-monospace, "SFMono-Regular", Menlo, monospace;
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .eyebrow { color: var(--accent); font-weight: 700; }
    h1 { margin: 18px 0 22px; max-width: 760px; overflow-wrap: anywhere; font-size: clamp(42px, 6.5vw, 76px); line-height: 0.98; letter-spacing: -0.055em; font-weight: 680; }
    .lede { max-width: 650px; margin: 0; color: var(--muted); font-size: clamp(17px, 2vw, 21px); }
    .status { border-top: 2px solid var(--ink); padding-top: 18px; }
    .status-line { display: flex; justify-content: space-between; gap: 20px; padding: 11px 0; border-bottom: 1px solid var(--line); font-size: 14px; }
    .status-line span:first-child { color: var(--muted); }
    .status-line strong { text-align: right; }
    .dot { display: inline-block; width: 8px; height: 8px; margin-right: 7px; border-radius: 50%; background: #2d7952; }
    section { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 42px; padding: 58px 0; border-top: 1px solid var(--line); }
    section h2 { margin: 0; font-size: 22px; letter-spacing: -0.025em; }
    .content { min-width: 0; }
    .endpoint { display: grid; grid-template-columns: 74px minmax(0, 1fr); gap: 18px; align-items: baseline; margin-bottom: 22px; }
    .method { color: var(--accent); font-weight: 750; }
    .path { font-family: ui-monospace, "SFMono-Regular", Menlo, monospace; font-size: 17px; font-weight: 650; }
    .endpoint p { grid-column: 2; margin: -10px 0 0; color: var(--muted); }
    pre {
      overflow-x: auto;
      margin: 24px 0;
      padding: 24px;
      color: #f7f4ef;
      background: var(--code);
      border-left: 4px solid var(--accent);
      border-radius: 3px;
      box-shadow: 0 18px 45px rgba(39, 31, 25, 0.11);
      font: 13px/1.65 ui-monospace, "SFMono-Regular", Menlo, monospace;
    }
    .note { padding: 18px 0 18px 20px; border-left: 2px solid var(--accent); color: var(--muted); }
    .fields { width: 100%; border-collapse: collapse; font-size: 14px; }
    .fields th, .fields td { padding: 13px 10px; text-align: left; border-bottom: 1px solid var(--line); vertical-align: top; }
    .fields th { color: var(--muted); font-weight: 550; }
    .fields code { font-family: ui-monospace, "SFMono-Regular", Menlo, monospace; }
    footer { display: flex; justify-content: space-between; gap: 24px; padding: 28px 0 48px; border-top: 1px solid var(--line); color: var(--muted); font-size: 13px; }
    @media (prefers-reduced-motion: no-preference) {
      .hero > *, section > * { animation: enter 520ms cubic-bezier(.16, 1, .3, 1) both; }
      .hero > :nth-child(2), section > :nth-child(2) { animation-delay: 90ms; }
      @keyframes enter { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    }
    @media (max-width: 760px) {
      .shell { width: min(100% - 28px, 1180px); }
      header { align-items: flex-start; padding: 20px 0; }
      nav { flex-direction: column; gap: 6px; text-align: right; }
      main { padding-top: 48px; }
      .hero, section { grid-template-columns: 1fr; gap: 30px; }
      .hero { padding-bottom: 56px; }
      section { padding: 44px 0; }
      .endpoint { grid-template-columns: 62px minmax(0, 1fr); }
      footer { flex-direction: column; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <div class="brand"><span class="mark" aria-hidden="true"></span>LinkedIn Profile API</div>
      <nav aria-label="Primary">
        <a href="#request">Request</a>
        <a href="/openapi.json">OpenAPI</a>
        <a href="${publicRepositoryUrl}/blob/main/docs/acceptance.md">Evidence</a>
        <a href="${publicRepositoryUrl}">Source</a>
      </nav>
    </header>
    <main>
      <div class="hero">
        <div>
          <div class="eyebrow">Direct HTTP / React Flight</div>
          <h1>Profile data, without a browser runtime.</h1>
          <p class="lede">A typed API that resolves LinkedIn's server-rendered RSC contracts into a stable, documented response. It fails closed on authentication, protection, and recognized schema-drift signals.</p>
        </div>
        <aside class="status" aria-label="Service characteristics">
          <div class="status-line"><span>Service</span><strong><span class="dot"></span>Online</strong></div>
          <div class="status-line"><span>Transport</span><strong>HTTPS + JSON</strong></div>
          <div class="status-line"><span>Runtime</span><strong>No browser</strong></div>
          <div class="status-line"><span>Access</span><strong>${authenticationLabel}</strong></div>
        </aside>
      </div>

      <section id="request">
        <h2>Request</h2>
        <div class="content">
          <div class="endpoint"><span class="method">POST</span><span class="path">/v1/profiles</span><p>${requestDescription}</p></div>
          <pre><code>curl -sS ${publicApiUrl}/v1/profiles \\
  -H 'content-type: application/json'${authorizationHeader} \\
  -d '{"url":"https://www.linkedin.com/in/example-person/"}'</code></pre>
          ${expiryLine}
          <p class="note">Only HTTPS <strong>linkedin.com/in/&lt;slug&gt;</strong> URLs are accepted. Query strings and fragments are removed before upstream access.</p>
        </div>
      </section>

      <section>
        <h2>Response</h2>
        <div class="content">
          <pre><code>${profileResponseExample}</code></pre>
          <table class="fields">
            <thead><tr><th>Field group</th><th>Behavior</th></tr></thead>
            <tbody>
              <tr><td><code>name</code>, <code>headline</code>, <code>location</code>, <code>about</code></td><td>Present only when visible and non-empty.</td></tr>
              <tr><td><code>experience</code>, <code>education</code></td><td>Structured records with available dates, descriptions, organizations, and locations.</td></tr>
              <tr><td><code>skills</code>, <code>certifications</code>, <code>languages</code></td><td>Direct RSC pagination, intentionally capped at 50 entries per section.</td></tr>
              <tr><td><code>profileImages</code></td><td>Validated HTTPS renditions associated with the profile owner.</td></tr>
              <tr><td><code>warnings</code></td><td>Explicit completeness signals, including the 50-item cap.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Failure contract</h2>
        <div class="content">
          <table class="fields">
            <thead><tr><th>Status</th><th>Meaning</th></tr></thead>
            <tbody>
              <tr><td><code>400</code></td><td>Malformed body or unsupported profile URL.</td></tr>
              ${accessFailureRow}
              <tr><td><code>404</code></td><td>The LinkedIn profile is unavailable to the configured session.</td></tr>
              <tr><td><code>413</code></td><td>Request body exceeds the configured size limit.</td></tr>
              <tr><td><code>415</code></td><td>Request content type is not JSON.</td></tr>
              <tr><td><code>429</code></td><td>Caller quota, cold-extraction budget, or bounded distinct-profile queue exceeded; respect <code>Retry-After</code>.</td></tr>
              <tr><td><code>500</code></td><td>Unexpected internal server error.</td></tr>
              <tr><td><code>502</code></td><td>LinkedIn authentication, protection, transport, or response-contract failure.</td></tr>
              <tr><td><code>503</code></td><td>LinkedIn runtime credentials are not configured.</td></tr>
            </tbody>
          </table>
          <p class="note">The service never solves or bypasses CAPTCHAs, checkpoints, access controls, or rate limits, and does not automatically retry protection signals.</p>
        </div>
      </section>
    </main>
    <footer><span>Tross engineering challenge · August 2026</span><span><a href="/health">Health</a> · <a href="/openapi.json">OpenAPI 3.1</a> · <a href="${publicRepositoryUrl}/blob/main/docs/acceptance.md">Evidence</a> · <a href="${publicRepositoryUrl}">GitHub</a></span></footer>
  </div>
</body>
</html>`;
}
