// V04-02 independent SYNTHETIC fixtures. No real people, private leagues, live data,
// provider calls or calibration claims. Numbers are deliberately chosen test inputs.
import assert from "node:assert/strict";
import { decisionBasis } from "../lib/decision/basis.js";
import { dropProtections } from "../lib/decision/add-drop.js";
import { buildTradeContext } from "../lib/trade/context.js";

export const VERSIONS = { model_version: "decision-0.3.2", feature_version: "weekly-features-2" };
export const player = (id, positions, start, extra = {}) => ({
  id, positions: Array.isArray(positions) ? positions : [positions], start, quality: 10,
  supported: true, injury: null, status: "Active", reserve: false, taxi: false,
  schedule: "scheduled", ...extra,
});

export function syntheticInputs({ rosters, slots = ["WR", "BN", "BN"], scoring = { rec: 1 },
  settings = { reserve_slots: 1, taxi_slots: 1 }, provider = "sleeper", placement = {},
  capabilities = { IR: { status: "available" }, taxiSquads: { status: "available" } },
  identity = { mode: "spectator", selected_roster_id: null, provider_user_id: null },
  levels = { QB: { replacement_value: 12, eligible_starter_demand: 1 },
    RB: { replacement_value: 5, eligible_starter_demand: 2 }, WR: { replacement_value: 7, eligible_starter_demand: 2 },
    TE: { replacement_value: 6, eligible_starter_demand: 1 } },
} = {}) {
  const snapshot = {
    identity: { provider, ...identity }, matchup_week: 6, my_roster: null,
    league: { league_id: "SYNTHETIC-V04-02", season: "2026", total_rosters: rosters.length,
      roster_positions: [...slots], scoring_settings: { ...scoring }, settings: { ...settings } },
    rosters: rosters.map((list, i) => ({ roster_id: i + 1, owner_id: `synthetic-owner-${i + 1}`, starter_slots: [],
      all_players: list.map(p => ({ player_id: p.id, fantasy_positions: [...p.positions], injury_status: p.injury,
        status: p.status, reserve: p.reserve, taxi: p.taxi })) })),
  };
  const contexts = {};
  // A full artificial population, including unrostered peers. Keeps ordinary test
  // players below the elite percentile without changing any protection policy.
  const peers = ["QB", "RB", "WR", "TE"].flatMap(pos => Array.from({ length: 24 }, (_, i) =>
    player(`synthetic-peer-${pos}-${i}`, pos, 35, { quality: 35 })));
  for (const p of [...peers, ...rosters.flat()]) contexts[p.id] = {
    player: { player_id: p.id, fantasy_positions: [...p.positions], injury_status: p.injury, status: p.status },
    model: { supported: p.supported, player_value: p.quality, start_value: { central: p.start },
      pickup_value: { central: 777 }, features: { current_games: 5, prior: { ppg: 10 },
        feature_inputs: { snap_share: 0.1, carry_share: 0.1 }, ...p.features } },
    schedule: { status: p.schedule }, analytics: { signals: p.legacySignals ?? [] },
  };
  const metadata = { provider, league_id: snapshot.league.league_id, season: "2026", week: 6,
    roster_positions: [...slots], roster_ids: snapshot.rosters.map(r => r.roster_id),
    identity_mode: identity.mode, selected_roster_id: identity.selected_roster_id, ...VERSIONS };
  return {
    snapshot, placement: structuredClone(placement), capabilities: structuredClone(capabilities),
    valueSource: { basis: decisionBasis(snapshot), metadata: structuredClone(metadata), contexts, levels: structuredClone(levels) },
    protectionEvidence: { producer: "add-drop dropProtections (SYNTHETIC V04-02)", population: "full_internal_contexts",
      metadata: structuredClone(metadata),
      players: dropProtections(snapshot.rosters.flatMap(r => r.all_players), slots, contexts) },
  };
}

export function built(inputs) {
  const result = buildTradeContext(inputs);
  assert.equal(result.ok, true, `Synthetic fixture must build: ${JSON.stringify(result.errors)}`);
  return result.context;
}
export const offer = (a, b, horizon = "next_game") => ({ horizon, sides: [
  { roster_id: 1, sends: a.map(id => ({ type: "player", id })) },
  { roster_id: 2, sends: b.map(id => ({ type: "player", id })) },
] });
export const sideOf = (result, id = 1) => {
  const side = result.sides.find(s => s.roster_id === String(id));
  assert.ok(side, `Missing side ${id}: ${JSON.stringify(result.errors)}`);
  return side;
};

export function leagueFixture(format) {
  assert.ok(["superflex-te-premium", "full-ppr"].includes(format));
  const sf = format === "superflex-te-premium", teams = sf ? 10 : 12;
  const slots = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", ...(sf ? ["SUPER_FLEX"] : ["K", "DEF"]),
    "BN", "BN", "BN", "IR", "TAXI"];
  const rosters = Array.from({ length: teams }, (_, index) => {
    const id = suffix => `r${index + 1}_${suffix}`;
    return [player(id("q1"), "QB", 24, { quality: 24 }),
      ...(sf ? [player(id("q2"), "QB", 18, { quality: 18 })] : []),
      player(id("rb1"), "RB", 15), player(id("rb2"), "RB", 10),
      player(id("wr1"), "WR", 16), player(id("wr2"), "WR", 12),
      player(id("te"), "TE", sf ? 17 : 11, { quality: sf ? 17 : 11 }),
      player(id("dual"), ["RB", "WR"], 13, { quality: 14 }),
      player(id("bench1"), "WR", 5, { quality: 9 }),
      player(id("bench2"), "RB", 4, { quality: 8 }),
      player(id("bench3"), "TE", 3, { quality: 7 }),
      ...(!sf ? [player(id("k"), "K", null, { quality: null, supported: false }),
        player(id("def"), "DEF", null, { quality: null, supported: false })] : []),
      player(id("ir"), "WR", null, { injury: "IR", reserve: true, quality: null }),
      player(id("taxi"), "RB", 4, { taxi: true, features: { current_games: 0, prior: { ppg: null } } }),
    ];
  });
  const inputs = syntheticInputs({ rosters, slots, scoring: sf ? { rec: 1, bonus_rec_te: 0.5 } : { rec: 1 } });
  if (sf) inputs.valueSource.levels.QB.eligible_starter_demand = 2;
  return { label: `SYNTHETIC ${teams}-team ${format}; supplied model values, not live validation`, inputs };
}

// A full receiving roster (capacity 3), sending a reserve player: receiving two
// active players requires k=2. All WRs have equal protection inputs, distinct starts.
export function twoDropInputs() {
  return syntheticInputs({ rosters: [
    [player("anchor", "WR", 20), player("low-A", "WR", 1), player("low-B", "WR", 2),
      player("outgoing-ir", "WR", null, { reserve: true, injury: "IR" })],
    [player("incoming-C", "WR", 3), player("incoming-D", "WR", 4)],
  ] });
}

export function reserveInputs(kind = "reserve", { usable = false, both = false } = {}) {
  const newcomers = [player("incoming-A", "WR", usable ? 40 : 4, { quality: 25, injury: usable ? null : "IR" }),
    player("incoming-B", "WR", 4, { quality: 25, injury: "IR" })];
  return syntheticInputs({
    rosters: [[player("starter", "WR", 20), player("bench", "WR", 1, { quality: 8 }), player("send", "WR", 2)], newcomers],
    placement: Object.fromEntries(newcomers.filter((_, i) => both || i === 0).map(p => [p.id,
      { reserve: kind === "reserve" ? "verified" : "unknown", taxi: kind === "taxi" ? "verified" : "unknown" }])),
    settings: { reserve_slots: kind === "reserve" ? 1 : 0, taxi_slots: kind === "taxi" ? 1 : 0 },
  });
}
