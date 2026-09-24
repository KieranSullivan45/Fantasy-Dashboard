import {test,expect} from '@playwright/test';
import {espnFixture} from '../test/provider-fixtures.js';
import {mockDefaultAccounts} from './accounts-fixture.js';
test('ESPN local preview stays private, supports spectator/roster and clears without disturbing Sleeper',async({page})=>{
 await mockDefaultAccounts(page);await page.route('**/api/snapshot?**',r=>r.fulfill({status:503,json:{error:'Fixture unavailable'}}));
 const uploads=[];page.on('request',r=>{if(r.method()!=='GET')uploads.push(r.url())});
 await page.setViewportSize({width:320,height:844});await page.goto('/dashboard/more');await page.getByRole('combobox',{name:'Provider',exact:true}).selectOption('espn');
 const file=page.getByLabel('Authorized ESPN league JSON');await file.setInputFiles({name:'authorized.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(espnFixture()))});
 const section=page.getByRole('region',{name:'Fantasy providers'});await expect(section).toContainText('Synthetic ESPN');await expect(section).toContainText('Spectator mode');await page.getByRole('combobox',{name:'Preview roster',exact:true}).selectOption('1');await expect(section).toContainText('Selected team: Team A');
 expect(uploads).toEqual([]);expect(await page.evaluate(()=>JSON.stringify(localStorage))).not.toContain('Synthetic ESPN');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'Remove imported preview'}).click();await expect(section).not.toContainText('Synthetic ESPN');
 await file.setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...espnFixture(),espn_s2:'FAKE_SECRET'}))});await expect(section.getByRole('alert')).toContainText('Import rejected');await expect(page.locator('body')).not.toContainText('FAKE_SECRET');
 await page.getByRole('combobox',{name:'Provider',exact:true}).selectOption('sleeper');await expect(page.getByLabel('Sleeper username',{exact:true})).toBeVisible();
});
test('deployed routing exposes provider capabilities and declines ESPN live requests',async({request})=>{
 for(const path of ['/api/accounts','/api/snapshot','/api/decision-support','/api/chat/waivers']){const r=await request.get(path+'?provider=espn&league=12345&season=2027');expect(r.status()).toBe(422);expect((await r.json()).code).toBe('UNSUPPORTED_FEATURE');}
});

