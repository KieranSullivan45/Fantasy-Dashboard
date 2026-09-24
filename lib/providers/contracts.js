export const DOMAIN_VERSION = "fantasy-domain-1";
export class ProviderError extends Error {
  constructor(code, provider, message) { super(message); this.name="ProviderError"; this.code=code; this.provider=provider; }
}
export const providerKey = ({provider="sleeper",leagueId,season,userId,rosterId}) => JSON.stringify([provider,String(leagueId),season??null,userId??null,rosterId??null]);
export const capability = (status,reason=null) => ({status,reason});
export function assertProvider(value="sleeper") {
  if(!["sleeper","espn"].includes(value))throw new ProviderError("UNSUPPORTED_FEATURE",String(value),"Choose Sleeper or ESPN.");return value;
}
export function unavailable(provider,feature) { throw new ProviderError("UNSUPPORTED_FEATURE",provider,`${feature} is not enabled for ${provider}. ESPN live access requires a permitted transport; no credentials are accepted.`); }
export function providerErrorResponse(error,status=422) {
  return Response.json({error:error instanceof ProviderError?error.message:"Provider request failed",code:error instanceof ProviderError?error.code:"PROVIDER_UNAVAILABLE",provider:error.provider||null},{status,headers:{"Cache-Control":"no-store"}});
}
