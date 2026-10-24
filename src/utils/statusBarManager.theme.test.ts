import { describe, it, expect } from 'vitest';
import { resolveSystemBarAppearance, STATUS_BAR_WALLET_GLASS, STATUS_BAR_SURFACE, STATUS_BAR_DIALOG_SCRIM } from './statusBarManager';

describe('native bar colors on appearance changes', () => {
  it('keeps Dark surfaces and bright icons', () => {
    expect(resolveSystemBarAppearance(STATUS_BAR_SURFACE, false)).toEqual({ color: STATUS_BAR_SURFACE, darkButtons: false });
  });
  it('maps wallet and sheet surfaces to warm Orange with dark icons', () => {
    expect(resolveSystemBarAppearance(STATUS_BAR_WALLET_GLASS, true)).toEqual({ color: '#F3ECE0', darkButtons: true });
    expect(resolveSystemBarAppearance(STATUS_BAR_SURFACE, true)).toEqual({ color: '#FFFCF7', darkButtons: true });
  });
  it('keeps modal scrims dark even in Orange mode', () => {
    expect(resolveSystemBarAppearance(STATUS_BAR_DIALOG_SCRIM, true)).toEqual({ color: STATUS_BAR_DIALOG_SCRIM, darkButtons: false });
  });
});
