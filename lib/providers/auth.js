import {ProviderError} from "./contracts.js";
/** Future server-only credential boundary. No credential persistence/collection exists. */
export class DisabledCredentialProvider {
 async get(){throw new ProviderError("AUTH_REQUIRED","espn","Private ESPN access is not enabled. Do not submit passwords or session cookies.");}
 async revoke(){return {status:"not_configured"};}
}
// Never include a raw response, request headers, cookie or URL in diagnostics.
export function providerHttpError(status,{provider="espn",knownExpired=false}={}){
 const code=knownExpired?"AUTH_EXPIRED":status===401?"AUTH_REQUIRED":status===403?"PRIVATE_LEAGUE":status===404?"LEAGUE_NOT_FOUND":status===429?"RATE_LIMITED":"PROVIDER_UNAVAILABLE";
 const messages={AUTH_EXPIRED:"Access has expired; reconnect through an approved secure flow.",AUTH_REQUIRED:"Authentication is required through an approved secure flow.",PRIVATE_LEAGUE:"Access to this league is not permitted.",LEAGUE_NOT_FOUND:"League or season was not found.",RATE_LIMITED:"Provider rate limit reached; retry later.",PROVIDER_UNAVAILABLE:"Provider is unavailable; retry later."};
 return new ProviderError(code,provider,messages[code]);
}
