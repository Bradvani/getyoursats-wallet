import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PRIVACY_POLICY_URL, SUPPORT_URL } from '@/constants/publicPages';

describe('GetYourSats policy and support links', () => {
  const menu = readFileSync('src/components/SideMenu.tsx', 'utf8');
  const settings = readFileSync('src/pages/SettingsPage.tsx', 'utf8');
  const pages = [
    { label: 'Privacy', name: 'PRIVACY_POLICY_URL', url: PRIVACY_POLICY_URL, path: '/privacy.html' },
    { label: 'Support', name: 'SUPPORT_URL', url: SUPPORT_URL, path: '/support.html' },
  ];

  it.each(pages)('links $label from both Menu and Settings', ({ name, url }) => {
    expect(menu).toContain(name);
    expect(settings).not.toContain(name);
    expect(url).toMatch(/^https:\/\/getyoursats\.com\/(privacy|support)$/);
  });

  it.each(pages)('keeps $label as a wallet-hosted fallback page', ({ path }) => {
    expect(existsSync('public' + path)).toBe(true);
    expect(readFileSync('public' + path, 'utf8')).toContain('GetYourSats');
  });
});
