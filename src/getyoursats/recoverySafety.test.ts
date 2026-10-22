import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const phraseScreens = [
  'src/pages/GeneratePage.tsx',
  'src/pages/BackupPage.tsx',
];

describe('recovery phrase safety invariants', () => {
  it.each(phraseScreens)('%s must not expose phrase copying', (filename) => {
    const source = readFileSync(filename, 'utf8');
    expect(source).not.toContain('copyToClipboard');
    expect(source).not.toContain('navigator.clipboard');
    expect(source).not.toContain('onClick={handleCopy}');
  });

  it.each(phraseScreens)('%s requests native capture protection', (filename) => {
    const source = readFileSync(filename, 'utf8');
    expect(source).toContain('useScreenCaptureProtection(true)');
  });
});
