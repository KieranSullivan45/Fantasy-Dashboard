export const MODEL_VERSION = "decision-0.3.2";
export const FEATURE_VERSION = "weekly-features-2";
export const POLICY = Object.freeze({ priorGames: 4, changedRolePriorGames: 1,
  immediate: { minimumStarterGain: 3, minimumNetGain: 1, minimumGames: 3, minimumCoverage: 70, minimumRoleScore: 55 },
  depthWeight: 0.25, scarcityWeight: 0.1, matchupPriorGames: 6, maximumPairsReturned: 3,
  protected: { snapShare: 0.2, carryShare: 0.1, elitePercentile: 85 },
});
export const POSITION_MODELS = {
  RB: { snap_share: [20, 0.8], carry_share: [20, 0.7], carries: [15, 20], targets: [10, 6], target_share: [5, 0.2], xfp: [25, 20], red_zone_opportunities: [5, 4] },
  WR: { snap_share: [15, 0.9], targets: [20, 10], target_share: [20, 0.3], air_yards: [5, 100], air_yard_share: [10, 0.4], wopr: [10, 0.8], xfp: [15, 20], red_zone_targets: [5, 3] },
  TE: { snap_share: [15, 0.8], targets: [20, 8], target_share: [20, 0.25], air_yards: [5, 70], air_yard_share: [10, 0.3], wopr: [10, 0.7], xfp: [15, 18], red_zone_targets: [5, 3] },
  QB: { dropbacks: [45, 40], carries: [20, 8], xfp: [25, 25], team_plays: [10, 70] },
};
