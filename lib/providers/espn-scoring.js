import {ProviderError} from "./contracts.js";
import {rejectCredentials} from "./espn-normalize.js";
/**
 * Authorized ESPN scoring configuration (`espn-scoring-1`). Server-side only: it is never imported by client code and
 * league-specific configurations are supplied at runtime (see `createEspnScoringResolver`), not bundled or committed.
 *
 * A configuration is a league owner's/member's explicit transcription of the ESPN League Info scoring screen. It is a
 * separate source from the ESPN facts transport (`scoring_source: "user_authorized"`), bound to provider + league +
 * season + schema version, and it never falls back to ESPN defaults. Rules are mapped only onto the existing internal
 * scoring vocabulary of `lib/normalize/scoring.js`; anything it cannot compute is listed as unsupported, never approximated.
 */
export const ESPN_SCORING_VERSION="espn-scoring-1";
export const SCORING_SOURCE="user_authorized";
const refuse=(message,code="INVALID_SCORING_CONFIG")=>new ProviderError(code,"espn",message);
const need=(ok,message)=>{if(!ok)throw refuse(message);};
const finite=v=>typeof v==="number"&&Number.isFinite(v);

// Offensive per-player rules with an exact existing internal rule (normalize/scoring.js RULES).
const OFFENSE_EXACT={passing_yards:"pass_yd",passing_td:"pass_td",interception_thrown:"pass_int",passing_2pt:"pass_2pt",passing_attempts:"pass_att",passing_completions:"pass_cmp",passing_incompletions:"pass_inc",
 rushing_yards:"rush_yd",rushing_td:"rush_td",rushing_2pt:"rush_2pt",rushing_attempts:"rush_att",
 receiving_yards:"rec_yd",reception:"rec",receiving_td:"rec_td",receiving_2pt:"rec_2pt",
 fumble_lost:"fum_lost",fumble:"fum",fumble_recovered_td:"fum_rec_td"};
// Kick/punt return TDs share the existing `st_td` rule (special_teams_tds, as for Sleeper) only when their coefficients are equal.
const OFFENSE_RETURN_TDS=["kickoff_return_td","punt_return_td"];
// No verified per-player statistic: listed as unsupported, never approximated.
const OFFENSE_UNSUPPORTED={interception_return_td:"No verified per-player defensive-return touchdown statistic",fumble_return_td:"No verified per-player fumble-return touchdown statistic",
 blocked_kick_return_td:"No verified per-player blocked-kick return touchdown statistic",two_point_return:"No verified per-player defensive two-point return statistic",one_point_safety:"No verified per-player one-point safety statistic"};
const OFFENSE_KEYS=new Set([...Object.keys(OFFENSE_EXACT),...OFFENSE_RETURN_TDS,...Object.keys(OFFENSE_UNSUPPORTED)]);
/** Offensive rules that must be declared explicitly (a value of 0 is allowed); omission means an incomplete transcription. */
export const REQUIRED_OFFENSE_RULES=Object.freeze(["passing_yards","passing_td","interception_thrown","rushing_yards","rushing_td","receiving_yards","reception","receiving_td","fumble_lost"]);
const KICKING_EXACT={pat_made:"xpm",pat_missed:"xpmiss",fg_missed:"fgmiss"};
// nflverse field-goal distance bands behind the existing fgm_* rules.
const FG_BANDS=[["fgm_0_19",0,19],["fgm_20_29",20,29],["fgm_30_39",30,39],["fgm_40_49",40,49],["fgm_50_59",50,59],["fgm_60p",60,null]];
const DEFENSE_KEYS=new Set(["sack","interception","fumble_recovered","fumble_forced","safety","blocked_kick","interception_return_td","fumble_return_td","kickoff_return_td","punt_return_td","blocked_kick_return_td","two_point_return","one_point_safety"]);
const TEAM_DEFENSE_REASON="Team D/ST scoring is not implemented: no team-defense statistics source; D/ST stays outside Football Value";

function checkBands(bands,label){
 need(Array.isArray(bands)&&bands.length>0,`${label} bands are required`);
 let previous=-1;
 bands.forEach((b,i)=>{need(b&&typeof b==="object"&&Number.isSafeInteger(b.min)&&b.min>=0&&(b.max===null||Number.isSafeInteger(b.max)&&b.max>=b.min)&&finite(b.points),`${label} band is malformed`);
  need(b.min>previous,`${label} bands must be ascending and non-overlapping`);need(b.max!==null||i===bands.length-1,`${label}: only the last band may be open-ended`);previous=b.max??Infinity;});
 return bands.map(b=>({min:b.min,max:b.max,points:b.points}));
}
/** Points for an integer value under banded rules; a value in no band scores 0 (unlisted ESPN rule, attested by the config). */
export function bandPoints(value,bands){
 if(!Number.isSafeInteger(value)||value<0)return null;
 return bands.find(b=>value>=b.min&&(b.max===null||value<=b.max))?.points??0;
}
const numericRules=(section,keys,label)=>{
 need(section&&typeof section==="object"&&!Array.isArray(section),`${label} section is required`);
 for(const [k,v]of Object.entries(section))if(!Array.isArray(v)){need(keys.has(k),`${label} rule is not recognized`);need(finite(v),`${label} rule values must be finite numbers`);}
};

/** Structural validation; returns a normalized copy. Unknown keys, gaps in attestation or malformed bands fail closed. */
export function validateEspnScoringConfig(config){
 need(config&&typeof config==="object"&&!Array.isArray(config),"configuration object is required");
 rejectCredentials(config);
 const allowed=new Set(["schema_version","provider","league_id","season","scoring_source","unlisted_rules_score_zero","source","offense","kicking","team_defense"]);
 need(Object.keys(config).every(k=>allowed.has(k)),"configuration has unrecognized fields");
 need(config.schema_version===ESPN_SCORING_VERSION,"unsupported scoring schema version");
 need(config.provider==="espn","configuration provider must be espn");
 need(typeof config.league_id==="string"&&/^\d{1,25}$/.test(config.league_id),"league_id must be a numeric string");
 need(Number.isSafeInteger(config.season)&&config.season>=2010&&config.season<=2100,"season must be a year");
 need(config.scoring_source===SCORING_SOURCE,"scoring_source must be user_authorized");
 need(config.unlisted_rules_score_zero===true,"the configuration must attest that every listed ESPN rule was transcribed and unlisted rules score 0");
 need(config.source==null||(typeof config.source==="object"&&Object.values(config.source).every(v=>typeof v==="string")),"source must be descriptive strings");
 numericRules(config.offense,OFFENSE_KEYS,"offense");
 for(const key of REQUIRED_OFFENSE_RULES)need(key in config.offense,"a required offensive rule is missing; the transcription is incomplete");
 numericRules(config.kicking,new Set([...Object.keys(KICKING_EXACT),"field_goals_made"]),"kicking");
 const kicking={...config.kicking};if("field_goals_made" in kicking)kicking.field_goals_made=checkBands(kicking.field_goals_made,"field_goals_made");
 numericRules(config.team_defense,new Set([...DEFENSE_KEYS,"points_allowed"]),"team_defense");
 const defense={...config.team_defense};if("points_allowed" in defense)defense.points_allowed=checkBands(defense.points_allowed,"points_allowed");
 return {schema_version:config.schema_version,provider:"espn",league_id:config.league_id,season:config.season,scoring_source:SCORING_SOURCE,unlisted_rules_score_zero:true,
  source:config.source?{...config.source}:null,offense:{...config.offense},kicking,team_defense:defense};
}

/**
 * Validated configuration → internal rules (normalize/scoring.js vocabulary) + explicit unsupported list.
 * `available` means every required offensive rule maps exactly; it never follows merely from a config existing.
 */
export function translateAuthorizedEspnScoring(input){
 const config=validateEspnScoringConfig(input),rules={},unsupported=[];
 const skip=(rule,points,reason,scope="player")=>unsupported.push({rule,points,scope,reason});
 for(const [key,points]of Object.entries(config.offense)){
  if(OFFENSE_EXACT[key]){if(points!==0)rules[OFFENSE_EXACT[key]]=points;}
  else if(OFFENSE_UNSUPPORTED[key]){if(points!==0){skip(key,points,OFFENSE_UNSUPPORTED[key]);rules[`unsupported_espn_${key}`]=points;}}
 }
 const returns=OFFENSE_RETURN_TDS.map(k=>config.offense[k]??0);
 if(returns.every(v=>v===returns[0])){if(returns[0]!==0)rules.st_td=returns[0];}
 else for(const key of OFFENSE_RETURN_TDS){const points=config.offense[key]??0;if(points!==0){skip(key,points,"Kick and punt return TDs share one statistic; unequal coefficients cannot be separated");rules[`unsupported_espn_${key}`]=points;}}
 for(const [key,points]of Object.entries(config.kicking))if(KICKING_EXACT[key]&&points!==0)rules[KICKING_EXACT[key]]=points;
 const fg=config.kicking.field_goals_made;
 if(fg){const beyond=Math.max(...fg.map(b=>(b.max??b.min)+1));
  // A statistical band maps exactly only when every distance inside it scores the same (bands are piecewise constant).
  for(const [rule,lo,hi]of FG_BANDS){const values=new Set();for(let d=lo;d<=(hi??Math.max(lo,beyond));d++)values.add(bandPoints(d,fg));
   if(values.size===1){const points=[...values][0];if(points!==0)rules[rule]=points;}
   else{rules[`fg_unsupported_${lo}_${hi??"plus"}`]=1;skip(`field_goals_made_${lo}_${hi??"plus"}`,[...values],"Configured distance bands split an available statistical band; kicker totals are partial","K");}}
 }
 for(const [key,points]of Object.entries(config.team_defense))if(key!=="points_allowed"&&points!==0)skip(`team_defense_${key}`,points,TEAM_DEFENSE_REASON,"DEF");
 if(config.team_defense.points_allowed?.some(b=>b.points!==0))skip("team_defense_points_allowed",config.team_defense.points_allowed.map(b=>({...b})),TEAM_DEFENSE_REASON,"DEF");
 const available=REQUIRED_OFFENSE_RULES.every(key=>OFFENSE_EXACT[key]);
 return {available,rules,unsupported,status:unsupported.some(u=>u.scope!=="DEF")?"partial":"complete",
  binding:{provider:config.provider,league_id:config.league_id,season:config.season,schema_version:config.schema_version}};
}

/**
 * Applies an authorized configuration to ESPN facts (`espn-facts-1`). Provider, league and season must match exactly;
 * facts that already carry provider scoring are never overridden. Transport provenance is left untouched.
 */
export function applyAuthorizedEspnScoring(facts,config){
 if(facts?.provider!=="espn"||config?.provider!=="espn")throw refuse("Scoring configuration and league must both be ESPN.","SCORING_CONFIG_MISMATCH");
 const translated=translateAuthorizedEspnScoring(config);
 if(translated.binding.league_id!==String(facts.league?.id))throw refuse("Scoring configuration is bound to a different league.","SCORING_CONFIG_MISMATCH");
 if(translated.binding.season!==facts.league?.season)throw refuse("Scoring configuration is bound to a different season.","SCORING_CONFIG_MISMATCH");
 if(facts.scoring?.available===true)throw refuse("League scoring is already supplied by the ESPN source; an authorized configuration cannot override it.","SCORING_CONFIG_CONFLICT");
 return {...facts,scoring:{available:translated.available,source:SCORING_SOURCE,rules:translated.rules,unsupported:translated.unsupported,status:translated.status,binding:translated.binding}};
}

/**
 * Config-loader boundary: resolves the one configuration bound to (provider, league, season), or null.
 * Backed here by an in-memory list; later implementations (server config, secure storage, UI-managed) keep this shape.
 */
export function createEspnScoringResolver(configs=[]){
 const byBinding=new Map();
 for(const config of configs){const c=validateEspnScoringConfig(config),key=JSON.stringify([c.provider,c.league_id,c.season]);
  if(byBinding.has(key))throw refuse("Duplicate scoring configurations for one league and season.");byBinding.set(key,c);}
 return ({provider,leagueId,season})=>provider==="espn"?byBinding.get(JSON.stringify([provider,String(leagueId),Number(season)]))??null:null;
}
