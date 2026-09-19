import { bytesToHex, hexToBytes, keccak256, type Hex } from "viem";
const ORDER = BigInt(
  "0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551",
);
export function decodeBase64url(s: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );
}
export function parseDerSignature(input: Uint8Array): { r: Hex; s: Hex } {
  let i = 0;
  if (input[i++] !== 0x30 || input[i++] !== input.length - 2)
    throw new Error("Unsupported passkey signature encoding");
  const integer = () => {
    if (input[i++] !== 2) throw new Error("Invalid signature integer");
    const n = input[i++]!;
    if (n < 1 || n > 33 || i + n > input.length)
      throw new Error("Invalid signature length");
    const b = input.slice(i, i + n);
    i += n;
    if ((b[0]! & 128) !== 0 || (n > 1 && b[0] === 0 && (b[1]! & 128) === 0))
      throw new Error("Invalid signature integer");
    const v = BigInt(bytesToHex(b));
    if (v <= 0n || v >= ORDER) throw new Error("Invalid signature value");
    return v;
  };
  const r = integer();
  let s = integer();
  if (i !== input.length) throw new Error("Trailing signature bytes");
  if (s > ORDER / 2n) s = ORDER - s;
  return {
    r: ("0x" + r.toString(16).padStart(64, "0")) as Hex,
    s: ("0x" + s.toString(16).padStart(64, "0")) as Hex,
  };
}
export async function registerPasskey() {
  if (!window.isSecureContext || !navigator.credentials)
    throw new Error("Passkeys require a secure browser on HTTPS or localhost.");
  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "Sprout Guardian", id: location.hostname },
      user: {
        id: crypto.getRandomValues(new Uint8Array(32)),
        name: "Sprout Guardian",
        displayName: "Sprout Guardian",
      },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
      attestation: "none",
      timeout: 60000,
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("Passkey creation cancelled");
  const response = credential.response as AuthenticatorAttestationResponse;
  const spki = response.getPublicKey();
  if (!spki)
    throw new Error("This authenticator does not expose a P-256 public key.");
  const key = await crypto.subtle.importKey(
    "spki",
    spki,
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", key);
  if (!jwk.x || !jwk.y) throw new Error("Invalid passkey public key");
  return {
    id: keccak256(new Uint8Array(credential.rawId)),
    x: bytesToHex(decodeBase64url(jwk.x)),
    y: bytesToHex(decodeBase64url(jwk.y)),
  };
}
export async function signWithPasskey(challenge: Hex) {
  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge: new Uint8Array(hexToBytes(challenge)),
      rpId: location.hostname,
      userVerification: "required",
      timeout: 60000,
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("Passkey approval cancelled");
  const response = credential.response as AuthenticatorAssertionResponse;
  const json = new TextDecoder().decode(response.clientDataJSON);
  const parsed = JSON.parse(json);
  if (
    parsed.type !== "webauthn.get" ||
    parsed.origin !== location.origin ||
    parsed.crossOrigin === true ||
    bytesToHex(decodeBase64url(parsed.challenge)) !== challenge
  )
    throw new Error("Passkey challenge or origin mismatch");
  const index = (s: string) => {
    const i = json.indexOf(s);
    if (i < 0) throw new Error("Unsupported passkey client data");
    return BigInt(new TextEncoder().encode(json.slice(0, i)).length);
  };
  return {
    deviceId: keccak256(new Uint8Array(credential.rawId)),
    assertion: {
      authenticatorData: bytesToHex(new Uint8Array(response.authenticatorData)),
      clientDataJSON: json,
      challengeIndex: index('"challenge":"'),
      typeIndex: index('"type":"'),
      originIndex: index('"origin":"'),
      ...parseDerSignature(new Uint8Array(response.signature)),
    },
  };
}
