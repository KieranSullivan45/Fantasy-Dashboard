// ESPN-LIVE-01 (ADR 0013): the dashboard offers the private ESPN league from /api/private-league and shows it live via Flaim.
// Every route is mocked with SYNTHETIC data; no Flaim or ESPN request is made.
import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {espnFactsFromFlaim} from '../lib/providers/flaim/espn-map.js';
import {snapshotFromEspnFacts} from '../lib/providers/espn-normalize.js';
import {mockDefaultAccounts} from './accounts-fixture.js';
const bundle=JSON.parse(readFileSync(new URL('../test/fixtures/flaim-espn/synthetic-league.json',import.meta.url),'utf8'));
const d=k=>bundle[k]?.data??null;
const snapshot=fetchedAt=>{const facts=espnFactsFromFlaim({session:d('session'),leagueInfo:d('leagueInfo'),rosters:bundle.rosters.map(r=>r.data),standings:d('standings'),matchups:d('matchups'),freeAgents:d('freeAgents'),transactions:d('transactions')},{access:'flaim_live'});
 return snapshotFromEspnFacts({...facts,provenance:{...facts.provenance,fetched_at:fetchedAt}},{crosswalk:[],includeOwnPending:true});};
test('private ESPN league loads live via Flaim, by provider, with refresh through the private path',async({page})=>{
 await mockDefaultAccounts(page);
 await page.route('**/api/private-league',r=>r.fulfill({json:{schema_version:'private-league-1',available:true,provider:'espn',league_id:'424242',season:2030,source:'live_flaim'}}));
 const reads=[],posts=[];
 await page.route('**/api/snapshot?**',r=>{const p=new URL(r.request().url()).searchParams;reads.push(Object.fromEntries(p));return p.get('provider')==='espn'?r.fulfill({json:snapshot(new Date().toISOString())}):r.fulfill({status:503,json:{error:'Sleeper not used here'}});});
 await page.route('**/api/decision-support?**',r=>r.fulfill({status:422,json:{error:'League scoring rules are unavailable from this ESPN source.',code:'UNSUPPORTED_FEATURE'}}));
 await page.route('**/api/refresh',r=>{posts.push(JSON.parse(r.request().postData()));return r.fulfill({json:{schema_version:'refresh-1',status:'ok',input_revision:null,previous_input_revision:null,failed:[],unresolved:[],snapshot:snapshot(new Date().toISOString())}});});
 await page.goto('/dashboard/home');
 await expect(page.getByText('Live via Flaim · read-only ESPN')).toBeVisible();
 await expect(page.getByLabel('Data source')).toContainText('Live via Flaim · read-only · last refreshed');
 await expect(page.locator('select[aria-label="League"]')).toHaveValue('espn:424242');
 await expect(page.locator('main')).toContainText('Synthetic Team One');
 expect(reads[0].provider).toBe('espn');expect(reads[0].league).toBe('424242');expect('user' in reads[0]).toBe(false);
 await page.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect.poll(()=>posts.length).toBe(1);expect(posts[0]).toMatchObject({league:'424242',provider:'espn',mode:'manual'});expect('user' in posts[0]).toBe(false);
 expect(await page.evaluate(()=>JSON.stringify(localStorage))).not.toContain('424242');
});
