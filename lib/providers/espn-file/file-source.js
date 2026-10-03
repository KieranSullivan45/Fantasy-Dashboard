import {closeSync,constants,copyFileSync,existsSync,fsyncSync,openSync,readFileSync,renameSync,rmSync,statSync,writeSync} from "node:fs";
import {randomBytes} from "node:crypto";
import {dirname,isAbsolute,join,basename} from "node:path";
import {ProviderError} from "../contracts.js";
import {outsideRepository,readPrivateJson} from "../../private/config.js";
import {espnFactsFromLeagueFile} from "./espn-map.js";
import {MAX_LEAGUE_FILE_BYTES} from "./schema.js";

/**
 * Saved ESPN league file (local private mode, ESPN-FILE-01, ADR 0012): server-only, no network. The file lives outside the
 * repository, is size-limited and is re-read only when its content digest changes.
 */
let cached=null;
/** Reads a league file → `{ facts, observedScoring, key, digest }`; unchanged content reuses the mapped result. */
export function readSavedLeagueFile(path,{root=process.cwd(),read=readFileSync,stat=statSync,now=Date.now()}={}){
 const {value,key,digest}=readPrivateJson(path,{root,maxBytes:MAX_LEAGUE_FILE_BYTES,label:"league file",read,stat});
 // A cache hit skips re-validation: identical bytes already passed, and `now` only moves forward.
 if(cached?.key===key)return cached;
 const mapped=espnFactsFromLeagueFile(value,{now});
 cached={key,digest,...mapped};
 return cached;
}

const refuse=message=>new ProviderError("PRIVATE_CONFIG_INVALID","espn",`League file import refused: ${message}`);
/**
 * Validates `source` and only then installs it at `destination` (both outside the repository): write a temporary file
 * beside the destination, flush it, keep the current file as `<destination>.prev`, then rename into place. An invalid file
 * never replaces the installed one. Returns the mapped result of the installed bytes.
 */
export function installLeagueFile(source,destination,{root=process.cwd(),now=Date.now(),validate=()=>{}}={}){
 if(typeof destination!=="string"||!isAbsolute(destination))throw refuse("the destination path must be absolute");
 if(!outsideRepository(destination,root)||!outsideRepository(`${destination}.prev`,root))throw refuse("the destination must be stored outside the repository");
 // The exact bytes that were validated are the bytes installed (no second read of the source).
 let bytes=null;
 const {value}=readPrivateJson(source,{root,maxBytes:MAX_LEAGUE_FILE_BYTES,label:"league file",read:path=>(bytes=readFileSync(path))});
 const mapped=espnFactsFromLeagueFile(value,{now});
 validate(mapped);
 const temp=join(dirname(destination),`.${basename(destination)}.${randomBytes(6).toString("hex")}.tmp`);
 let fd=null;
 try{
  fd=openSync(temp,"wx",0o600);writeSync(fd,bytes);fsyncSync(fd);closeSync(fd);fd=null;
  // Replace any existing backup (never follow a link there), then copy the current file exclusively.
  if(existsSync(destination)){rmSync(`${destination}.prev`,{force:true});copyFileSync(destination,`${destination}.prev`,constants.COPYFILE_EXCL);}
  renameSync(temp,destination);
 }catch(error){
  if(fd!==null)try{closeSync(fd);}catch{}
  rmSync(temp,{force:true});
  if(error instanceof ProviderError)throw error;
  throw refuse("the file could not be written");
 }
 return mapped;
}
