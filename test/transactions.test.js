import test from "node:test";
import assert from "node:assert/strict";
import { summarizeTransactions } from "../lib/derive.js";
import { transactionPieces } from "../lib/transaction-display.js";

test("pick-only and FAAB-only trades preserve direction and display all assets", () => {
  const rosterViews = [{ roster_id: 1, team_name: "Alpha" }, { roster_id: 2, team_name: "Beta" }];
  const txs = summarizeTransactions({ rosterViews, transactions: [
    { transaction_id: "pick", type: "trade", status: "complete", draft_picks: [{ season: "2027", round: 2, roster_id: 3, previous_owner_id: 1, owner_id: 2 }] },
    { transaction_id: "faab", type: "trade", status: "pending", waiver_budget: [{ sender: 2, receiver: 1, amount: 0 }] },
  ] });
  assert.match(transactionPieces(txs[0], rosterViews)[0], /2027 round 2 pick \(original: Team 3\).*Alpha → Beta/);
  assert.match(transactionPieces(txs[1], rosterViews)[0], /FAAB 0.*Beta → Alpha/);
  assert.equal(txs[1].status, "pending");
});

test("deduplication keeps latest status before filtering; zero waiver bids survive", () => {
  const txs = summarizeTransactions({ transactions: [
    { transaction_id: "1", status: "pending", status_updated: 1 },
    { transaction_id: "1", status: "failed", status_updated: 2 },
    { transaction_id: "2", status: "complete", settings: { waiver_bid: 0 }, adds: { unknown: 9 } },
  ] });
  assert.equal(txs.length, 1);
  assert.equal(txs[0].waiver_bid, 0);
  assert.equal(txs[0].adds[0].player.player_id, "unknown");
  assert.equal(txs[0].adds[0].team_name, "Team 9");
});
