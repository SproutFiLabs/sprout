import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
import type { SproutDb } from "../db";

/** Owner-scoped authenticated encryption; none of the document payload is stored as plaintext. */
export class ExpansionStore {
  constructor(
    readonly db: SproutDb,
    private key: Buffer,
  ) {
    if (key.length !== 32)
      throw Error("SPROUT_V3_DATA_KEY must contain 32 bytes.");
    db.exec(
      "CREATE TABLE IF NOT EXISTS v3_documents(id TEXT NOT NULL, owner TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(owner,kind,id)); CREATE TABLE IF NOT EXISTS v3_receipts(reference TEXT PRIMARY KEY, owner TEXT NOT NULL);",
    );
  }
  owner(address: string) {
    return createHmac("sha256", this.key)
      .update(address.toLowerCase())
      .digest("hex");
  }
  private seal(owner: string, kind: string, id: string, value: unknown) {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    c.setAAD(Buffer.from(`${owner}:${kind}:${id}`));
    const body = Buffer.concat([c.update(JSON.stringify(value)), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
  }
  private open<T>(owner: string, kind: string, id: string, payload: string): T {
    const b = Buffer.from(payload, "base64");
    const c = createDecipheriv("aes-256-gcm", this.key, b.subarray(0, 12));
    c.setAAD(Buffer.from(`${owner}:${kind}:${id}`));
    c.setAuthTag(b.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([c.update(b.subarray(28)), c.final()]).toString(),
    );
  }
  get<T>(address: string, kind: string, id: string): T | null {
    const owner = this.owner(address);
    const row = this.db
      .query<{ body: string }, [string, string, string]>(
        "SELECT body FROM v3_documents WHERE owner=? AND kind=? AND id=?",
      )
      .get(owner, kind, id);
    return row ? this.open<T>(owner, kind, id, row.body) : null;
  }
  list<T>(address: string, kind: string): T[] {
    const owner = this.owner(address);
    return this.db
      .query<{ id: string; body: string }, [string, string]>(
        "SELECT id,body FROM v3_documents WHERE owner=? AND kind=? ORDER BY rowid DESC LIMIT 5000",
      )
      .all(owner, kind)
      .map((r) => this.open<T>(owner, kind, r.id, r.body));
  }
  put(address: string, kind: string, id: string, value: unknown) {
    const owner = this.owner(address);
    this.db.run(
      "INSERT INTO v3_documents VALUES(?,?,?,?) ON CONFLICT(owner,kind,id) DO UPDATE SET body=excluded.body",
      [id, owner, kind, this.seal(owner, kind, id, value)],
    );
  }
  delete(address: string, kind: string, id: string) {
    this.db.run("DELETE FROM v3_documents WHERE owner=? AND kind=? AND id=?", [
      this.owner(address),
      kind,
      id,
    ]);
  }
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
  claim(reference: string, address: string) {
    this.db.run("INSERT INTO v3_receipts VALUES(?,?)", [
      reference,
      this.owner(address),
    ]);
  }
}
