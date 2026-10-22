import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('GetYourSats static policy and support pages', () => {
  const menu = readFileSync('src/components/SideMenu.tsx', 'utf8');
  const links = ['/privacy.html', '/support.html'];
  it('links official pages from the menu', () => {
    for (const path of links) expect(menu).toContain(path);
  });
  it.each(links)('ships %s in public', (path) => {
    expect(existsSync('public' + path)).toBe(true);
  });
});
