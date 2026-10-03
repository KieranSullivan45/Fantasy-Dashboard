import {ESPN_SCORING_STATS} from "../espn-normalize.js";
import {translateAuthorizedEspnScoring} from "../espn-scoring.js";

/**
 * Internal rules that both the verified ESPN statistic table and the authorized-configuration translation produce exactly.
 * Only these are compared; everything else in a league file's scoring items is evidence that cannot be checked.
 */
export const COMPARABLE_SCORING_RULES=Object.freeze(["pass_att","pass_cmp","pass_inc","pass_yd","pass_td","pass_2pt","pass_int","rush_att","rush_yd","rush_td","rush_2pt",
 "rec","rec_yd","rec_td","rec_2pt","fum","fum_lost","xpm","xpmiss","fgmiss"]);
const COMPARABLE=new Set(COMPARABLE_SCORING_RULES);
const EPSILON=1e-9;

/**
 * Cross-checks a league file's observed ESPN scoring items against the user-authorized scoring configuration (ADR 0003,
 * ADR 0012). The file is never a scoring source: this only decides whether the two agree. Pure; returns counts only.
 *
 * - An absent comparable item scores 0 on either side (the configuration attests unlisted rules score 0).
 * - Items with positional overrides, verified ids outside the comparable set and unverified ids are not compared.
 * - status: "unavailable" (no file scoring), "mismatch" (any compared rule differs), "not_comparable" (nothing to
 *   compare) or "consistent".
 */
export function crossCheckEspnScoring(items,config){
 if(!Array.isArray(items))return {status:"unavailable",compared:0,mismatched:0,not_comparable:0,unverified:0};
 const authorized=translateAuthorizedEspnScoring(config).rules,file=new Map(),overridden=new Set();
 let notComparable=0,unverified=0;
 for(const item of items){
  const key=ESPN_SCORING_STATS[item.statId];
  if(!key){unverified++;continue;}
  if(!COMPARABLE.has(key)){notComparable++;continue;}
  if(item.pointsOverrides&&Object.keys(item.pointsOverrides).length){overridden.add(key);notComparable++;continue;}
  file.set(key,item.points);
 }
 let compared=0,mismatched=0;
 for(const key of COMPARABLE_SCORING_RULES){
  if(overridden.has(key))continue;
  compared++;
  if(Math.abs((file.get(key)??0)-(authorized[key]??0))>EPSILON)mismatched++;
 }
 return {status:mismatched?"mismatch":compared?"consistent":"not_comparable",compared,mismatched,not_comparable:notComparable,unverified};
}
