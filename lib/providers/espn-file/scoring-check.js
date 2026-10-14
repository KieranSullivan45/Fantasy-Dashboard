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
 * ADR 0012). The file is corroboration only, never a scoring source: this only decides whether the two can be shown to agree.
 * Pure; returns counts only.
 *
 * - An omitted item has unknown meaning (no public contract says omitted means zero), so it is never read as 0: when the
 *   file has scoring items, every comparable rule must be explicitly present, else the verdict is "incomplete".
 * - A comparable item's base points are always compared. A positional override that differs from its base points is a
 *   mismatch: the authorized configuration cannot express positional premiums, so the two cannot be shown to agree.
 * - Verified ids outside the comparable set and unverified ids are counted, never mapped, and never satisfy completeness.
 * - status: "unavailable" (the file has no scoring section), "mismatch" (an explicitly present rule differs), "incomplete"
 *   (no difference shown, but at least one comparable rule is absent) or "consistent" (all present and all equal).
 *   Only "consistent" and "unavailable" let the authorized configuration apply.
 */
export function crossCheckEspnScoring(items,config){
 if(!Array.isArray(items))return {status:"unavailable",compared:0,mismatched:0,missing:0,not_comparable:0,unverified:0};
 const authorized=translateAuthorizedEspnScoring(config).rules,file=new Map(),overridden=new Set();
 let notComparable=0,unverified=0;
 for(const item of items){
  const key=Object.hasOwn(ESPN_SCORING_STATS,item.statId)?ESPN_SCORING_STATS[item.statId]:null;
  if(!key){unverified++;continue;}
  if(!COMPARABLE.has(key)){notComparable++;continue;}
  if(item.pointsOverrides&&Object.values(item.pointsOverrides).some(v=>Math.abs(v-item.points)>EPSILON))overridden.add(key);
  file.set(key,item.points);
 }
 let compared=0,mismatched=0,missing=0;
 for(const key of COMPARABLE_SCORING_RULES){
  if(!file.has(key)){missing++;continue;}
  compared++;
  if(overridden.has(key)||Math.abs(file.get(key)-(authorized[key]??0))>EPSILON)mismatched++;
 }
 return {status:mismatched?"mismatch":missing?"incomplete":"consistent",compared,mismatched,missing,not_comparable:notComparable,unverified};
}

/** True when a verdict lets the authorized configuration apply. */
export const crossCheckAllowsScoring=result=>result.status==="consistent"||result.status==="unavailable";
