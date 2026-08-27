import crypto from "node:crypto";

const TOKEN_SECRET: string =
  process.env.SESSION_SECRET ??
  (() => {
    throw new Error(
      "SESSION_SECRET is required to sign/verify rider bearer tokens",
    );
  })();

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function signRiderToken(riderId: string): string {
  const payload = b64url(Buffer.from(riderId, "utf8"));
  const sig = b64url(
    crypto.createHmac("sha256", TOKEN_SECRET).update(payload).digest(),
  );
  return `${payload}.${sig}`;
}

export function verifyRiderToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payload, sig] = parts;
  const expected = b64url(
    crypto.createHmac("sha256", TOKEN_SECRET).update(payload).digest(),
  );
  const actualBuffer = Buffer.from(sig);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    return Buffer.from(
      payload.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
  } catch {
    return null;
  }
}