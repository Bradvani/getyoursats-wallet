import {expect, test, type Locator, type Page} from '@playwright/test';

// Desktop WebKit cannot display an iPhone's system keyboard. These tests use
// production components + the production viewport manager and inject only the
// browser geometry events. Physical iOS Safari/PWA acceptance stays separate.
const origin = 'http://localhost:5173';
type Geometry = {height: number; offsetTop: number; scale?: number; pageTop?: number; scrollY?: number};
type ViewportEvent = 'resize' | 'scroll';
type FocusEvidence = {kind: 'focus' | 'touchend'; field: string; opacity?: string; prevented?: boolean};
type ViewportWindow = Window & {
  __setKeyboardViewport?: (next: Geometry, events?: ViewportEvent[]) => void;
  __sheetFocusEvidence?: FocusEvidence[];
  __gysScanFixture?: {resolveInput: () => void; evidence: () => {mutations: number}};
};
test.use({hasTouch: true});

test.beforeEach(async ({page, context}) => {
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === origin && url.pathname === '/api/market-overview') return route.fulfill({json:{supply:null,sentiment:null}});
    if (url.origin === origin && ['GET', 'HEAD'].includes(request.method()) && !url.pathname.startsWith('/api/')) return route.continue();
    return route.abort('blockedbyclient');
  });
  await page.addInitScript(() => {
    class KeyboardViewport extends EventTarget {
      height = innerHeight;
      width = innerWidth;
      offsetTop = 0;
      offsetLeft = 0;
      pageTop = 0;
      pageLeft = 0;
      scale = 1;
      onresize = null;
      onscroll = null;
    }
    const viewport = new KeyboardViewport();
    Object.defineProperty(window, 'visualViewport', {value: viewport, configurable: true});
    (window as ViewportWindow).__setKeyboardViewport = (next, events = ['resize', 'scroll']) => {
      const {scrollY: documentScroll, pageTop, ...visual} = next;
      if (documentScroll !== undefined) {
        // Independent coordinate inputs, not real document scrolling. A fixed
        // sheet uses offsetTop even when pageTop also includes document scroll.
        Object.defineProperty(window, 'scrollY', {value: documentScroll, configurable: true});
        Object.defineProperty(window, 'pageYOffset', {value: documentScroll, configurable: true});
      }
      Object.assign(viewport, {scale: 1, ...visual, pageTop: pageTop ?? window.scrollY + next.offsetTop});
      for (const event of events) viewport.dispatchEvent(new Event(event));
    };
  });
});

test.afterEach(async ({page}) => {
  expect(await page.evaluate(() => (window as ViewportWindow).__gysScanFixture?.evidence().mutations)).toBe(0);
});

async function keyboard(page: Page, geometry: Geometry, events?: ViewportEvent[]) {
  await page.evaluate(({next, events}) => (window as ViewportWindow).__setKeyboardViewport!(next, events),
    {next: geometry, events});
}
async function focusWithoutScrolling(field: Locator) {
  // Hidden opening-animation content cannot accept focus. Wait only for
  // visibility, without clicking or asking the browser to scroll the field.
  await expect(field).toBeVisible();
  await field.evaluate(element => (element as HTMLElement).focus({preventScroll: true}));
  await expect(field).toBeFocused();
}
async function expectFieldInVisibleArea(field: Locator, top: number, height: number) {
  await expect(field).toBeFocused();
  // No Playwright click/fill/scrollIntoView before measuring: those would hide
  // a broken application reveal by scrolling the target on behalf of the app.
  await expect.poll(() => field.evaluate((element, area) => {
    const rect = element.getBoundingClientRect();
    const scroller = element.closest('.react-modal-sheet-content-scroller')!;
    const clip = scroller.getBoundingClientRect();
    return rect.top >= Math.max(clip.top, area.top) &&
      rect.bottom <= Math.min(clip.bottom, area.top + area.height) &&
      rect.left >= 0 && rect.right <= innerWidth;
  }, {top, height})).toBe(true);
}
async function expectFieldHitTarget(field: Locator) {
  await expect.poll(() => field.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit === element || element.contains(hit);
  })).toBe(true);
}

for (const [width, height] of [[320, 667], [375, 667], [390, 844], [430, 932]]) {
  test(`portrait ${width}: recipient, amount and comment remain reachable through keyboard cycles`, async ({page}, testInfo) => {
    await page.setViewportSize({width, height});
    await page.goto(origin + '/e2e/fixtures/scan-send.html?comments=1');
    await page.getByTestId('send-button').click();
    const recipient = page.getByTestId('payment-input');
    await expect.poll(() => recipient.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
    await focusWithoutScrolling(recipient);
    await keyboard(page, {height: height - 330, offsetTop: 42});
    await expectFieldInVisibleArea(recipient, 42, height - 330);
    await recipient.fill('alice@example.invalid');
    await page.screenshot({path: testInfo.outputPath(`recipient-${width}.png`)});
    await recipient.press('Enter');
    await keyboard(page, {height, offsetTop: 42}); // iOS stale dismissal offset
    await page.evaluate(() => (window as ViewportWindow).__gysScanFixture!.resolveInput());
    const amount = page.getByLabel('Amount', {exact: true});
    await expect(amount).toBeVisible();
    await focusWithoutScrolling(amount);
    await keyboard(page, {height: height - 350, offsetTop: 28});
    await expectFieldInVisibleArea(amount, 28, height - 350);
    await amount.fill('100');
    const comment = page.locator('#lnurl-comment');
    await focusWithoutScrolling(comment);
    await expectFieldInVisibleArea(comment, 28, height - 350);
    await comment.fill('Thank you');
    // Switch upwards without another keyboard resize event.
    await focusWithoutScrolling(amount);
    await expectFieldInVisibleArea(amount, 28, height - 350);
    await focusWithoutScrolling(comment);
    await expectFieldInVisibleArea(comment, 28, height - 350);
    const scroller = page.locator('.web-sheet-scrollport').last();
    await expect(scroller).toHaveCSS('touch-action', 'pan-y pinch-zoom');
    await page.screenshot({path: testInfo.outputPath(`comment-${width}.png`)});
    await comment.evaluate(element => (element as HTMLElement).blur());
    await keyboard(page, {height, offsetTop: 28});
    await expect(page.locator('.react-modal-sheet-root:has([data-testid="send-flow"])')).toHaveCSS('top', '0px');
    await expect(page.locator('#root')).toHaveCSS('transform', 'none');
    await expect(amount).toHaveValue('100');
    await expect(comment).toHaveValue('Thank you');
    await page.getByRole('button', {name: 'Close', exact: true}).click();
    await expect(page.getByTestId('send-flow')).toHaveCount(0);
    await page.getByTestId('send-button').click();
    await expect(page.getByTestId('payment-input')).toBeVisible();
  });
}

test('enlarged text stays editable in a short portrait keyboard viewport', async ({page}) => {
  await page.setViewportSize({width: 375, height: 667});
  await page.goto(origin + '/e2e/fixtures/scan-send.html');
  await page.evaluate(() => {document.documentElement.style.fontSize = '32px';});
  await page.getByTestId('send-button').click();
  const recipient = page.getByTestId('payment-input');
  await focusWithoutScrolling(recipient);
  await keyboard(page, {height: 337, offsetTop: 25});
  // A large textarea can exceed the available height. Its top and caret entry
  // must remain accessible and the sheet must still have a scrollable range.
  await expect.poll(() => recipient.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return rect.top >= 25 && rect.top < 200 && rect.left >= 0 && rect.right <= innerWidth;
  })).toBe(true);
  await recipient.fill('alice@example.invalid');
  await expect(recipient).toHaveValue('alice@example.invalid');
  expect(await page.locator('.web-sheet-scrollport').last().evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
});

test('Spark amount browser reveal cannot pan the outer sheet above the keyboard', async ({page}, testInfo) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.goto(origin + '/e2e/fixtures/scan-send.html?kind=spark&manual=1');
  await page.getByTestId('send-button').tap();
  const recipient = page.getByTestId('payment-input');
  await recipient.tap();
  await expect(recipient).toBeFocused();
  await page.keyboard.type('spark1synthetic');
  await page.keyboard.press('Enter');
  const amount = page.getByTestId('amount-input');
  await expect(amount).toBeVisible();
  const sheet = page.locator('.react-modal-sheet-root:has([data-testid="send-flow"])');
  await expect(sheet).toHaveAttribute('data-sheet-state', 'open');

  // Safari's focus reveal may walk every ancestor, including overflow:hidden
  // boxes. At the content snap the full-height translated card overflows its
  // outer root. Scrolling that root shifts the entire form/header, separately
  // from the intended inner scroller. Keep the frame non-scrollable while
  // letting the inner scrollport reveal the field.
  const outerPan = await amount.evaluate(element => {
    (element as HTMLElement).focus(); // Deliberately no preventScroll.
    element.scrollIntoView({block: 'center', behavior: 'instant'});
    const root = element.closest<HTMLElement>('.react-modal-sheet-root')!;
    const focusPan = root.scrollTop;
    root.scrollTop = 350; // Simulate a delayed outer-scroll attempt.
    return {focusPan, delayedPan: root.scrollTop};
  });
  expect(outerPan).toEqual({focusPan: 0, delayedPan: 0});
  await expect(sheet).toHaveCSS('overflow', 'clip');

  for (const geometry of [{height: 494, offsetTop: 28}, {height: 337, offsetTop: 42}]) {
    await keyboard(page, geometry);
    await expectFieldInVisibleArea(amount, geometry.offsetTop, geometry.height);
    expect(await sheet.evaluate(el => el.scrollTop)).toBe(0);
    await expect(sheet).toHaveCSS('height', `${geometry.height}px`);
    await expect(sheet).toHaveCSS('top', `${geometry.offsetTop}px`);
  }
  // The field must accept a real tap and keyboard text after reveal. Neither
  // fill() nor programmatic focus is used to rescue it after the resize.
  await amount.tap();
  await expect(amount).toBeFocused();
  await page.keyboard.type('100');
  await expect(amount).toHaveValue('100');
  const scroller = sheet.locator('.web-sheet-scrollport');
  const scroll = await scroller.evaluate(element => {
    element.scrollTop = element.scrollHeight;
    return {top: element.scrollTop, range: element.scrollHeight - element.clientHeight};
  });
  expect(scroll.range).toBeGreaterThan(0);
  expect(scroll.top).toBeGreaterThan(0);
  expect(await sheet.evaluate(el => el.scrollTop)).toBe(0);
  await page.screenshot({path: testInfo.outputPath('spark-amount-keyboard-outer-pan.png')});
  await amount.evaluate(element => (element as HTMLElement).blur());
  await keyboard(page, {height: 844, offsetTop: 42});
  await expect(sheet).toHaveCSS('top', '0px');
  await page.getByRole('button', {name: 'Close', exact: true}).tap();
  await expect(page.getByTestId('send-flow')).toHaveCount(0);
  await page.getByTestId('send-button').tap();
  await expect(page.getByTestId('payment-input')).toBeVisible();
});

test.describe('iOS web focus event path with simulated keyboard geometry', () => {
  // The UA enables the production iOS touch guard; the browser still cannot
  // display or reproduce an iPhone system keyboard or its compositor panning.
  test.use({userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'});

  test('first taps remain editable when keyboard pan settles without another event, including reopen', async ({page}) => {
    await page.setViewportSize({width: 390, height: 844});
    await page.addInitScript(() => {
      const evidence: FocusEvidence[] = [];
      (window as ViewportWindow).__sheetFocusEvidence = evidence;
      document.addEventListener('focusin', event => {
        const field = event.target;
        if (!(field instanceof HTMLElement) || !field.matches('[data-testid="payment-input"], [data-testid="amount-input"]')) return;
        evidence.push({kind: 'focus', field: field.dataset.testid!, opacity: getComputedStyle(field).opacity});
      }, true);
      // Observe the result after the sheet's native capture listener, without
      // cancelling or synthesizing touch/focus events on the application's behalf.
      document.addEventListener('touchend', event => {
        const field = event.target;
        if (!(field instanceof HTMLElement) || !field.matches('[data-testid="payment-input"], [data-testid="amount-input"]')) return;
        evidence.push({kind: 'touchend', field: field.dataset.testid!, prevented: event.defaultPrevented});
      });
    });
    await page.goto(origin + '/e2e/fixtures/scan-send.html?kind=spark&manual=1');

    for (const offsetTop of [350, 380]) {
      await page.evaluate(() => { (window as ViewportWindow).__sheetFocusEvidence!.length = 0; });
      await page.getByTestId('send-button').tap();
      const recipient = page.getByTestId('payment-input');
      await recipient.tap();
      await expect(recipient).toBeFocused();
      await page.keyboard.type('spark1synthetic');
      await page.keyboard.press('Enter');
      const amount = page.getByTestId('amount-input');
      const sheet = page.locator('.react-modal-sheet-root:has([data-testid="send-flow"])');
      await expect(sheet).toHaveAttribute('data-sheet-state', 'open');
      await amount.tap();
      await expect(amount).toBeFocused();

      const intermediate = await page.evaluate(async finalTop => {
        const update = (window as ViewportWindow).__setKeyboardViewport!;
        update({height: 417, offsetTop: 0}, ['resize']);
        // Let the original one-RAF handler consume the incomplete snapshot.
        // Three rendering frames model late metric settling within ~100ms.
        await new Promise<void>(resolve => requestAnimationFrame(() =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        const root = document.querySelector<HTMLElement>('.react-modal-sheet-root:has([data-testid="send-flow"])')!;
        const before = {height: root.style.height, top: root.style.top};
        update({height: 417, offsetTop: finalTop}, []); // No resize, scroll, or focus event follows.
        return before;
      }, offsetTop);
      expect(intermediate).toEqual({height: '417px', top: '0px'});
      await expect(sheet).toHaveCSS('top', `${offsetTop}px`);
      await expectFieldInVisibleArea(amount, offsetTop, 417);
      await expectFieldHitTarget(amount);
      expect(await sheet.evaluate(element => element.scrollTop)).toBe(0);
      await expect(amount).toHaveCSS('opacity', '1');

      const evidence = await page.evaluate(() => (window as ViewportWindow).__sheetFocusEvidence!);
      for (const field of ['payment-input', 'amount-input']) {
        expect(evidence).toContainEqual({kind: 'focus', field, opacity: '0'});
        expect(evidence).toContainEqual({kind: 'touchend', field, prevented: true});
      }
      // Type into the existing focus; no fill/focus/scrollIntoView rescues the
      // field after the delayed geometry update. A focused tap stays native.
      await page.keyboard.type('100');
      await expect(amount).toHaveValue('100');
      await amount.tap();
      expect(await page.evaluate(() => {
        const touches = (window as ViewportWindow).__sheetFocusEvidence!
          .filter(event => event.kind === 'touchend' && event.field === 'amount-input');
        return touches[touches.length - 1]?.prevented;
      })).toBe(false);
      await expect(amount).toBeFocused();
      await expect(amount).toHaveValue('100');

      // Explicit blur models keyboard dismissal only; physical Done-key and
      // PWA acceptance remain separate from this desktop browser replay.
      await amount.evaluate(element => (element as HTMLElement).blur());
      await keyboard(page, {height: 844, offsetTop}, ['resize']);
      await expect(sheet).toHaveCSS('top', '0px');
      await expect(sheet).toHaveCSS('height', '844px');
      const close = page.getByRole('button', {name: 'Close', exact: true});
      await expectFieldHitTarget(close);
      await close.tap();
      await expect(page.getByTestId('send-flow')).toHaveCount(0);
    }
  });

  test('fixed sheet follows visual offset independently of document coordinates', async ({page}) => {
    await page.setViewportSize({width: 390, height: 844});
    await page.goto(origin + '/e2e/fixtures/scan-send.html');
    await page.getByTestId('send-button').tap();
    const recipient = page.getByTestId('payment-input');
    await recipient.tap();
    await expect(recipient).toBeFocused();
    await keyboard(page, {height: 417, offsetTop: 84, pageTop: 174, scrollY: 90}, ['resize']);
    const sheet = page.locator('.react-modal-sheet-root:has([data-testid="send-flow"])');
    await expect(sheet).toHaveCSS('top', '84px');
    await expectFieldInVisibleArea(recipient, 84, 417);
    await expectFieldHitTarget(recipient);
    await page.keyboard.type('alice@example.invalid');
    await expect(recipient).toHaveValue('alice@example.invalid');
    await recipient.evaluate(element => (element as HTMLElement).blur());
    await keyboard(page, {height: 844, offsetTop: 84, pageTop: 84, scrollY: 0});
    await expect(sheet).toHaveCSS('top', '0px');
    await page.getByRole('button', {name: 'Close', exact: true}).tap();
    await expect(page.getByTestId('send-flow')).toHaveCount(0);
  });
});

test('pinch zoom is preserved and is not treated as an open keyboard', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.goto(origin + '/e2e/fixtures/scan-send.html');
  await page.getByTestId('send-button').click();
  await keyboard(page, {height: 422, offsetTop: 100, scale: 2});
  await expect(page.locator('html')).not.toHaveClass(/keyboard-visible/);
  await expect(page.locator('#root')).toHaveCSS('transform', 'none');
  const sheet = page.locator('.react-modal-sheet-root:has([data-testid="send-flow"])');
  await expect(sheet).toHaveCSS('height', '844px');
  await expect(sheet).toHaveCSS('top', '0px');
  const content = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(content).not.toMatch(/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:\D|$)/);
});
