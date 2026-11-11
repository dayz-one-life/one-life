import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

/**
 * The attestation: the public record that the private golden suites passed against exactly this
 * source, this harness and this golden data — signed, so it cannot be written without the data.
 *
 * Why a signature. Every input of a hash is public: anyone can recompute `sourceHash` and type the
 * counts they like. The signing key lives ONLY in the private golden repository
 * (`$DEATH_GOLDEN_DIR/attest-key/`), beside the data. So a valid `golden-attest.json` can only
 * come from a machine that has the golden data, which is the thing the gate claims.
 *
 * ⚠️ What it does not prove: that the person with the key ran the suites honestly. And a pull
 * request can replace `golden-attest.pub.pem` together with the attestation — a change to that
 * file is a change to WHO MAY ATTEST and must be reviewed as one.
 *
 * ⚠️ Counts and hashes only. Never a uid, a name or a position.
 */
export interface Attestation {
  /** `src/**` — the classifier. */
  sourceHash: string;
  /** The private suites, their helpers, the scripts and the golden command. */
  harnessHash: string;
  /** The private data the suites read, answers included. */
  corpusSha: string;
  classifierVersion: number;
  /** How many private suites ran, and how many tests in them. All passed, none skipped. */
  suites: number;
  tests: number;
  rows: number;
  passed: number;
  gaps: number;
  totals: { definitive: number; strong: number; inferred: number; killLine: number };
  /** Ed25519 over `attestPayload`, base64. */
  signature: string;
}
export type UnsignedAttestation = Omit<Attestation, "signature">;

/** The bytes that are signed: the fields in a fixed order, no whitespace. */
export function attestPayload(a: UnsignedAttestation): Buffer {
  const t = a.totals;
  return Buffer.from(JSON.stringify([
    "onelife death-verdict golden attestation v1",
    a.sourceHash, a.harnessHash, a.corpusSha, a.classifierVersion, a.suites, a.tests, a.rows, a.passed, a.gaps,
    t?.definitive, t?.strong, t?.inferred, t?.killLine,
  ]), "utf8");
}

export function signAttestation(a: UnsignedAttestation, privateKeyPem: string): Attestation {
  const signature = sign(null, attestPayload(a), createPrivateKey(privateKeyPem)).toString("base64");
  return { ...a, signature };
}

/** True when the signature is this key's signature of these fields. Never throws. */
export function verifyAttestation(a: Partial<Attestation>, publicKeyPem: string): boolean {
  try {
    if (typeof a.signature !== "string" || a.signature === "") return false;
    return verify(null, attestPayload(a as UnsignedAttestation), createPublicKey(publicKeyPem), Buffer.from(a.signature, "base64"));
  } catch {
    return false;
  }
}

/** True when the private key is the other half of the public key. */
export function keysMatch(privateKeyPem: string, publicKeyPem: string): boolean {
  try {
    const derived = createPublicKey(createPrivateKey(privateKeyPem)).export({ type: "spki", format: "der" });
    return derived.equals(createPublicKey(publicKeyPem).export({ type: "spki", format: "der" }));
  } catch {
    return false;
  }
}
