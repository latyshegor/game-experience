// Run: PLAYWRIGHT_MODULE=/path/to/playwright node tests/visual-smoke.cjs
// Uses an isolated browser and synthetic records; never reads a real diary.
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { homedir } = require('node:os');
const { join } = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.SCREENSHOT_DIR || join(homedir(), '.openclaw/logs/game-elena-qa');
const url = process.env.TEST_URL || 'http://127.0.0.1:4173';
(async () => {
  mkdirSync(output, {recursive:true});
  const browser = await chromium.launch({channel:'chrome',headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1000}, reducedMotion:'reduce'});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const click = act => page.locator(`[data-act="${act}"]:visible`).first().click();
    const shot = name => page.screenshot({path:`${output}/${name}.png`, fullPage:true});
    const state = () => page.evaluate(() => {const s=JSON.parse(localStorage.getItem('experience.v1')); return s.games.find(g=>g.id===s.activeId);});
    const fit = async name => {
      const m = await page.evaluate(() => ({width:innerWidth,scroll:document.documentElement.scrollWidth,broken:[...document.images].filter(i=>!i.complete || i.naturalWidth===0).map(i=>i.src)}));
      assert.ok(m.scroll <= m.width + 1,`${name}: horizontal overflow ${m.scroll}/${m.width}`);
      assert.deepEqual(m.broken,[],`${name}: broken images`);
    };
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    await fit('home'); await shot('desktop-home');
    await click('diary'); await shot('desktop-diary-empty');
    await click('new'); await shot('desktop-request');
    await page.locator('#req').fill('Хочу найти дело, которое меня вдохновляет');
    await click('rules'); await page.keyboard.press('Escape');
    assert.equal(await page.locator('#req').inputValue(),'Хочу найти дело, которое меня вдохновляет','Opening the rules must preserve an unfinished answer');
    await click('req-next');
    for(let i=0;i<5;i++) {
      await page.locator('#ans').fill(`Проверочная запись ${i+1}: ясность, вдохновение и интерес.`);
      if(i===1) { await shot('desktop-question'); await click('q-back'); assert.equal(await page.locator('#ans').inputValue(),'Проверочная запись 1: ясность, вдохновение и интерес.'); await click('q-next'); }
      await click('q-next');
    }
    await shot('desktop-confirm'); await click('confirm-yes'); await shot('desktop-entry');
    for(let i=0;i<30 && (await state()).phase==='entry';i++) {
      const g=await state();
      if(g.step==='rethink') { await click('rethink-done'); continue; }
      await click('entry-draw');
      if((await state()).phase==='entry') await click('modal-ok');
    }
    assert.equal((await state()).phase,'play');
    await shot('desktop-element'); await click('enter-go');
    await click('dir'); await shot('desktop-game');
    // Follow legal moves using the actual controls until a card effect is open.
    for(let i=0;i<80;i++) {
      const g=await state();
      if(g.pending?.type==='effect') break;
      if(g.pending?.type==='direction') {await click('dir');continue;}
      if(g.pending?.type==='exitChoice') {await click('exit-stay');continue;}
      if(g.pending?.type==='back') {await click('back-save');continue;}
      if(await page.locator('.hand-card.ok').count()) {
        const card=page.locator('.hand-card.ok').first();
        if(await card.getAttribute('aria-pressed')!=='true') await card.click();
        await click('play'); continue;
      }
      if(await page.locator('[data-act=draw]:enabled').count()) {await click('draw');continue;}
      if(await page.locator('[data-act=end-turn]').count()) {await click('end-turn');continue;}
      if(await page.locator('[data-act=step-back]').count()) {await click('step-back');continue;}
      throw new Error(`Unexpected state ${JSON.stringify(g.pending)}`);
    }
    assert.equal((await state()).pending.type,'effect');
    await page.locator('#note').fill('Сохранённое открытие: могу двигаться маленькими шагами.');
    await shot('desktop-card'); await click('effect-save');
    assert.ok((await state()).journal.some(j=>j.note==='Сохранённое открытие: могу двигаться маленькими шагами.'));
    await click('sheet'); await page.locator('#notes').fill('Мои результаты сохраняются.'); await shot('desktop-route');
    await click('diary'); await shot('desktop-diary');
    await page.reload(); await click('continue');
    assert.equal((await state()).notes,'Мои результаты сохраняются.');
    await fit('game resumed');
    await page.setViewportSize({width:390,height:844});
    await shot('mobile-game'); await fit('mobile game');
    await click('home'); await shot('mobile-home'); await fit('mobile home');
    await click('new'); await shot('mobile-request'); await fit('mobile request');
    await click('rules'); await shot('mobile-rules');
    const dialog = page.getByRole('dialog',{name:'Как играть',exact:true});
    assert.equal(await dialog.count(),1);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(()=>document.activeElement.dataset.act),'rules-close');
    await page.keyboard.press('Escape'); assert.equal(await dialog.count(),0);
    await click('diary'); await shot('mobile-diary'); await fit('mobile diary');
    for(const width of [320,580,768,1024,1280,1920]) {
      await page.setViewportSize({width,height:900}); await click('home'); await fit(`home ${width}`);
    }
    // Deterministic visual fixtures cover rare cards and the final screen.
    const played = await page.evaluate(() => JSON.parse(localStorage.getItem('experience.v1')).games.find(g=>g.phase==='play'));
    const showGame = async game => {
      await page.evaluate(game => localStorage.setItem('experience.v1',JSON.stringify({games:[game],activeId:game.id})),game);
      await page.reload(); await click('continue');
    };
    for(const [kind,token] of [['obstacle',7],['resource',9],['hint',15]]) {
      const fixture = structuredClone(played);
      fixture.journal.push({t:'card',step:2,token,kind,card:2,note:'',ts:Date.now()});
      fixture.pending={type:'effect',j:fixture.journal.length-1};
      await showGame(fixture);
      await page.setViewportSize({width:1440,height:1000}); await shot(`desktop-${kind}`); await fit(kind);
      await page.setViewportSize({width:390,height:844}); await shot(`mobile-${kind}`); await fit(`mobile ${kind}`);
      await page.locator('#note').fill('Тестовая запись'); await click('effect-save');
      assert.equal((await state()).journal.at(-1).note,'Тестовая запись');
    }
    const finale = structuredClone(played); finale.pending={type:'finish'};
    await showGame(finale); await click('finish-draw'); await shot('mobile-finish');
    await page.locator('#note').fill('Главное осознание сохранено.'); await click('finish-done');
    assert.equal((await state()).phase,'finished');
    const download = page.waitForEvent('download'); await click('download');
    await (await download).saveAs(`${output}/route.txt`);
    await page.setViewportSize({width:1440,height:1000}); await shot('desktop-finished-route');
    await page.emulateMedia({media:'print'}); await shot('print-route');
    assert.equal(await page.locator('.topbar').isVisible(),false);
    await page.emulateMedia({media:'screen'});
    assert.deepEqual(errors,[],'browser errors');
    console.log('PASS: desktop + mobile, request with 5 answers, back, rules preserve draft, entry, direction, legal move, note, route, persistence, diary, modal keyboard, images, 8 widths, all 3 decks, finish, text export, print layout; 0 browser errors.');
    console.log(`Screenshots: ${output}`);
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
