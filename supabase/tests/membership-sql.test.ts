import { applySeed, openDb, sqlTest, withCase } from "./_harness.ts";
import { MEMBERSHIP_CASES } from "./_cases-membership.ts";

const db = await openDb();
await applySeed(db);

for (const c of MEMBERSHIP_CASES) sqlTest(`membership: ${c.name}`, withCase(db, c.run));
