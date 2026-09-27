import {SleeperProvider} from "./sleeper.js";
import {ESPNProvider} from "./espn.js";
import {assertProvider,unavailable,ProviderError} from "./contracts.js";
import {privateModeEnabled} from "../private/config.js";
import {createPrivateEspnProvider} from "./flaim/private-source.js";
const providers={sleeper:new SleeperProvider(),espn:new ESPNProvider()};
let privateEspn=null,privateFactory=createPrivateEspnProvider;
/** The local private-mode ESPN provider (ADR 0005). Handed out only to requests that passed `privateRequest`. */
const privateProvider=()=>privateModeEnabled()?(privateEspn??=privateFactory()):null;
/** Replaces how the private ESPN provider is built (tests; a later approved transport). Resets the cached instance. */
export function setPrivateEspnProviderFactory(factory=createPrivateEspnProvider){privateFactory=factory;privateEspn=null;}
export const getProvider=(id="sleeper")=>providers[assertProvider(id)];
export const loadFantasyContext=(id,options={})=>getProvider(options.provider||"sleeper").getDecisionContext(id,options);
export const loadFantasySnapshot=(id,options={})=>getProvider(options.provider||"sleeper").getSnapshot(id,options);
/**
 * Resolves the provider for a public route. ESPN serves league data only to a guarded local private request (never to
 * chat/accounts, which do not pass `privateRequest`); everything else keeps the public capability check.
 */
export function requestProvider(params,{live=true,privateRequest=null}={}){
 if(params.getAll('provider').length>1)throw new ProviderError('INVALID_QUERY',null,'Repeated provider parameters are not supported.');
 const id=assertProvider(params.get('provider')||'sleeper');
 const provider=id==="espn"&&privateRequest?privateProvider()??providers.espn:providers[id];
 if(live){const caps=provider.getProviderCapabilities();
  if(caps.publicLeagueAccess.status!=='available'&&!(privateRequest&&caps.privateLeagueAccess?.status==='available'))unavailable(provider.providerId,'Live access');}
 return provider;
}
/** True when `provider` is serving private league data (responses must be `private, no-store`). */
export const isPrivateProvider=provider=>provider.getProviderCapabilities().privateLeagueAccess?.status==='available';
