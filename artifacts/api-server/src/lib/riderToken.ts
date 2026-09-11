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

function hmac(value: string): string {
  return b64url(
    crypto.createHmac("sha256", TOKEN_SECRET).update(value).digest(),
  );
}

export function signRiderToken(riderId: string): string {
  const payload = b64url(Buffer.from(riderId, "utf8"));
  const sig = hmac(payload);
  return `${payload}.${sig}`;
}

export function verifyRiderToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payload, sig] = parts;
  const expected = hmac(payload);
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

type OrderOfferPayload = {
  orderId: string;
  riderId: string;
  expiresAt: number;
  nonce: string;
};

/**
 * Signs a short-lived offer that is valid for one rider and one unassigned
 * order only. The acceptance route consumes it through its existing atomic
 * order assignment, so the same offer cannot claim an order twice.
 */
export function signOrderOfferToken(payload: OrderOfferPayload): string {
  const encoded = b64url(
    Buffer.from(JSON.stringify({ v: 1, ...payload }), "utf8"),
  );
  return `${encoded}.${hmac(`rider-order-offer.${encoded}`)}`;
}

export function verifyOrderOfferToken(token: string): OrderOfferPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [encoded, signature] = parts;
  const expected = hmac(`rider-order-offer.${encoded}`);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
        "utf8",
      ),
    );
    if (
      parsed?.v !== 1 ||
      typeof parsed.orderId !== "string" ||
      typeof parsed.riderId !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      typeof parsed.nonce !== "string" ||
      parsed.nonce.length < 16 ||
      !Number.isSafeInteger(parsed.expiresAt) ||
      parsed.expiresAt <= Date.now()
    ) {
      return null;
    }
    return {
      orderId: parsed.orderId,
      riderId: parsed.riderId,
      expiresAt: parsed.expiresAt,
      nonce: parsed.nonce,
    };
  } catch {
    return null;
  }
}