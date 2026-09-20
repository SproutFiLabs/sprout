import type { SproutDb } from "../db";
import type { ArenaLeague, GrowthEvent } from "@sprout/shared";
import { ExpansionStore } from "./store";
import { AuthError } from "../auth";
function configured(db: SproutDb) {
  if (
    !db
      .query(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='v3_documents'",
      )
      .get()
  )
    return null;
  const key = process.env.SPROUT_V3_DATA_KEY;
  if (!key || !/^[0-9a-fA-F]{64}$/.test(key)) {
    if (
      db.query<{ n: number }, []>("SELECT count(*) n FROM v3_documents").get()!
        .n
    )
      throw new AuthError(
        "Restore the expansion data key before reviewing or erasing these records.",
        503,
      );
    return null;
  }
  return new ExpansionStore(db, Buffer.from(key, "hex"));
}
export function expansionFootprint(db: SproutDb, address: string) {
  const store = configured(db);
  if (!store) return 0;
  return db
    .query<{ n: number }, [string]>(
      "SELECT count(*) n FROM v3_documents WHERE owner=?",
    )
    .get(store.owner(address))!.n;
}
export function eraseExpansion(db: SproutDb, address: string) {
  const store = configured(db);
  if (!store) return;
  const owner = address.toLowerCase();
  for (const event of store.list<GrowthEvent>(owner, "event"))
    store.delete("event-links", "index", event.id);
  for (const league of store.list<ArenaLeague>("leagues", "league")) {
    if (league.owner === owner) {
      store.delete("leagues", "league", league.id);
      for (const m of league.members)
        store.delete(m.owner, "league-score", league.id);
    } else if (league.members.some((m) => m.owner === owner)) {
      league.members = league.members.filter((m) => m.owner !== owner);
      store.put("leagues", "league", league.id, league);
    }
  }
  db.run("DELETE FROM v3_documents WHERE owner=?", [store.owner(owner)]);
  /* Retain transaction references against replay, without an owner association. */ db.run(
    "UPDATE v3_receipts SET owner='' WHERE owner=?",
    [store.owner(owner)],
  );
}
