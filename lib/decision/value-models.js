import { weeklyFeatures, forecast } from "./features.js";
import { CALIBRATION } from "./calibration/weights.js";
import { MODEL_VERSION, FEATURE_VERSION } from "./model-config.js";
import { unavailableThisWeek } from "./team-strength.js";
export function playerModels(context, priorHistory, { season, week, generatedAt }) {
  const position = context.production?.scoring_positions?.[0] || context.player.position;
  const features = weeklyFeatures(context.analytics?.history || [], priorHistory, position, { season, week, currentTeam: context.player.team });
  const weights = CALIBRATION[position];
  const supported = !!weights;
  const start = supported ? forecast(features, weights.start.weights) : { central: null, coverage: 0 };
  const pickup = supported ? forecast(features, weights.pickup.weights) : { central: null, coverage: 0 };
  const available = !unavailableThisWeek(context.player) && !/^(d|doubtful)$/i.test(context.player.injury_status || "") && context.schedule.status === "scheduled";
  return { model_version: MODEL_VERSION, feature_version: FEATURE_VERSION, data_through_week: features.data_through_week, generated_at: generatedAt,
    supported, player_value: features.quality_points, features,
    start_value: { ...start, available_this_week: available, weekly_start_value: available ? start.central : null,
      uncertainty: features.uncertainty, basis: "Calibrated next-observed-game estimate; availability is separate. Matchup retained as context until separately validated." },
    pickup_value: { ...pickup, horizon: "three-calendar-week observed-game mean", basis: "Football acquisition input; legal add/drop roster impact and Pickup Rating are separate" },
    market_value: null, market_observation_contract: { source: null, observed_at: null, format: null, value: null, redistribution_permitted: false },
    limitation: supported ? null : "K/DST/IDP advanced model unsupported; use availability and schedule" };
}
