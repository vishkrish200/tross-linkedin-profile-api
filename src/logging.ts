const redactedPaths = [
  "req.headers.authorization",
  "req.headers.cookie",
  "request.headers.authorization",
  "request.headers.cookie",
  "headers.authorization",
  "headers.cookie",
  "body",
  "response",
] as const;

export function buildLoggerOptions(
  level: string,
  stream?: { write(message: string): void },
) {
  return {
    level,
    redact: {
      paths: [...redactedPaths],
      censor: "[REDACTED]",
    },
    ...(stream ? { stream } : {}),
  };
}
