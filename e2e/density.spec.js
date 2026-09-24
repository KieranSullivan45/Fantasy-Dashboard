import {test,expect} from '@playwright/test';
import {buildDecisionContext} from '../lib/decision/build-context.js';
import {decisionFixtureOptions} from '../test/decision-fixtures.js';
import {mockDefaultAccounts} from './accounts-fixture.js';
const A='1401373864818192384',B='1395493939665989632';
async function setup(page){
 await mockDefaultAccounts(page);const o=decisionFixtureOptions(),s=await o.loadLeague(A),d=await buildDecisionContext(A,o);
 const template=d.waivers.recommendations[0];
 const candidates=Array.from({length:12},(_,i)=>({...structuredClone(template),player_id:String(65-i)}));
 d.waivers.categories.best_overall={label:'Best overall adds',total:12,omitted:0,players:candidates};
 for(const c of candidates)d.waivers.candidate_details[c.player_id]=c;
 d.signals={total:14,omitted:0,records:Array.from({length:14},(_,i)=>({signal_id:String(i),player_id:String(65-Math.floor(i/2)),type:i%2?'TARGET_SHARE_SPIKE':'ROLE_EXPANSION',severity:i<2?'notable':'context',direction:'up',confidence:i<2?'moderate':'low',sample_size:3,data_through_week:3,evidence:{snap_share:[.45,.61,.79],target_share:[.12,.18,.25]},warnings:['Small sample'],explanation:'Fixture evidence',provenance:['nflverse']}))};
 await page.route('**/api/snapshot?**',async r=>{const id=new URL(r.request().url()).searchParams.get('league');const snap=await o.loadLeague(id);await r.fulfill({json:snap})});
 await page.route('**/api/decision-support?**',async r=>{const id=new URL(r.request().url()).searchParams.get('league');await r.fulfill({json:id===A?d:await buildDecisionContext(id,o)})});return d;
}
test('waivers bound initial DOM, retain exact values and lazy evidence, preserve expansion without cross-league leakage',async({page})=>{
 const d=await setup(page);await page.goto('/dashboard/waivers');
 const cards=page.locator('.recommendationCard');await expect(cards).toHaveCount(5);
 await expect(cards.first()).toContainText(d.waivers.recommendations[0].pickup_rating.toFixed(1));
 await expect(page.locator('.scoreComponents')).toHaveCount(0);
 const toggle=cards.first().getByRole('button',{name:'Recommendation details'});await toggle.click();await expect(toggle).toHaveAttribute('aria-expanded','true');await expect(cards.first().locator('.scoreComponents')).toHaveCount(1);
 await page.locator('nav:visible a[href="/dashboard/signals"]').click();await page.locator('nav:visible a[href="/dashboard/waivers"]').click();await expect(cards.first().getByRole('button',{name:'Recommendation details'})).toHaveAttribute('aria-expanded','true');
 await cards.first().getByRole('button',{name:'Recommendation details'}).click();await expect(page.locator('.scoreComponents')).toHaveCount(0);
 await page.getByRole('button',{name:/Show more recommendations/}).click();await expect(cards).toHaveCount(10);await page.getByRole('button',{name:/Show more recommendations/}).click();await expect(cards).toHaveCount(12);
 await page.getByText('Switch league or season',{exact:true}).click();await page.getByLabel('League',{exact:true}).selectOption(B);await expect(cards.first().getByRole('button',{name:'Recommendation details'})).toHaveAttribute('aria-expanded','false');
});
test('signals group all records, show strongest first and preserve full evidence on demand',async({page})=>{
 await setup(page);await page.goto('/dashboard/signals');const cards=page.locator('.signalCard');await expect(cards).toHaveCount(5);await expect(cards.first()).toContainText('Player 65');await expect(cards.first()).toContainText('2 signals');await expect(cards.first()).toContainText('45% → 61% → 79%');
 await expect(page.locator('.signalRecord')).toHaveCount(0);await cards.first().getByRole('button',{name:'View 2 signals'}).click();await expect(page.locator('.signalRecord')).toHaveCount(2);await expect(cards.first()).toContainText('TARGET SHARE SPIKE');await cards.first().getByRole('button',{name:'View 2 signals'}).click();await expect(page.locator('.signalRecord')).toHaveCount(0);
 await page.getByRole('button',{name:/Show more signals/}).click();await expect(cards).toHaveCount(7);
});
test('compact controls, roster groups and player details are keyboard accessible',async({page})=>{
 await setup(page);await page.goto('/dashboard/lineup');await expect(page.getByLabel('League',{exact:true})).toBeHidden();await expect(page.locator('.accountManager')).toHaveCSS('display','flex');
 const row=page.locator('.compactPlayer').first();await expect(row).toContainText('StartValue');await expect(page.locator('.playerQuickContext')).toHaveCount(0);const detail=row.getByRole('button',{name:/Details/});await detail.focus();await page.keyboard.press('Enter');await expect(detail).toHaveAttribute('aria-expanded','true');await expect(row.locator('.playerQuickContext')).toBeVisible();
 const starters=page.getByRole('button',{name:/Starters \(/});await starters.click();await expect(starters).toHaveAttribute('aria-expanded','false');await starters.click();
 await page.locator('nav:visible a[href="/dashboard/players"]').click();await expect(page.locator('.playerResults article')).toHaveCount(0);await page.getByLabel('Search players').fill('Player 65');await expect(page.locator('.playerResults article')).toHaveCount(1);
 await page.locator('nav:visible a[href="/dashboard/more"]').click();await expect(page.getByLabel('Sleeper username',{exact:true})).toBeVisible();
});
for(const width of [320,375,390,414])test(`expanded evidence remains mobile safe at ${width}px`,async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await setup(page);await page.setViewportSize({width,height:844});await page.goto('/dashboard/waivers');
 await page.locator('.recommendationCard').first().getByRole('button',{name:'Recommendation details'}).click();
 await page.locator('.recommendationCard').first().getByText('Score components',{exact:true}).click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await expect.poll(()=>page.evaluate(async()=>{scrollTo(0,document.documentElement.scrollHeight);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return document.querySelector('main').getBoundingClientRect().bottom-document.querySelector('.mobileNav').getBoundingClientRect().top})).toBeLessThanOrEqual(0);
 await page.locator('nav:visible a[href="/dashboard/signals"]').click();await page.locator('.signalCard').first().getByRole('button',{name:/View/}).click();await page.locator('.signalRecord').first().getByText('Signal evidence',{exact:true}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});
