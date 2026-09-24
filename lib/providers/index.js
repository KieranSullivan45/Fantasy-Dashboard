import {SleeperProvider} from "./sleeper.js";
import {ESPNProvider} from "./espn.js";
import {assertProvider,unavailable,ProviderError} from "./contracts.js";
const providers={sleeper:new SleeperProvider(),espn:new ESPNProvider()};
export const getProvider=(id="sleeper")=>providers[assertProvider(id)];
export const loadFantasyContext=(id,options={})=>getProvider(options.provider||"sleeper").getDecisionContext(id,options);
export const loadFantasySnapshot=(id,options={})=>getProvider(options.provider||"sleeper").getSnapshot(id,options);
export function requestProvider(params,{live=true}={}){
 if(params.getAll('provider').length>1)throw new ProviderError('INVALID_QUERY',null,'Repeated provider parameters are not supported.');
 const provider=getProvider(params.get('provider')||'sleeper');
 if(live&&provider.getProviderCapabilities().publicLeagueAccess.status!=='available')unavailable(provider.providerId,'Live access');
 return provider;
}
