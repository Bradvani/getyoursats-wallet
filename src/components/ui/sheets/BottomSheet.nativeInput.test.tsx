import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {BottomSheetCard, BottomSheetContainer} from './BottomSheet';
import {waitForSheetOpen} from '@/test/utils/waitForSheetOpen';

vi.mock('@capacitor/core', () => ({
  Capacitor: {isNativePlatform: () => true, getPlatform: () => 'android'},
}));
vi.mock('@capacitor/keyboard', () => ({
  Keyboard: {addListener: vi.fn(async () => ({remove: vi.fn()}))},
}));
vi.mock('../../../hooks/useStatusBarColor', () => ({useStatusBarColor: vi.fn()}));
vi.mock('../../../hooks/useBackButton', () => ({useBackButton: vi.fn()}));

describe('native form sheet gestures', () => {
  it('reserves content for field focus and vertical scrolling while retaining the drag handle', async () => {
    render(<BottomSheetContainer isOpen showBackdrop onClose={() => {}}>
      <BottomSheetCard disableContentDrag>
        <label>Destination<textarea /></label>
        <label>Amount<input inputMode="numeric" /></label>
      </BottomSheetCard>
    </BottomSheetContainer>);
    await waitForSheetOpen();

    const content = document.querySelector<HTMLElement>('.react-modal-sheet-content')!;
    const scroller = document.querySelector<HTMLElement>('.react-modal-sheet-content-scroller')!;
    expect(content.style.touchAction).not.toBe('pan-x');
    expect(scroller.style.touchAction).toBe('pan-y');
    expect(scroller).toHaveClass('sheet-form-scrollport');
    expect(document.querySelector('.bottom-sheet-handle-zone')).not.toBeNull();

    const destination = screen.getByRole('textbox', {name: 'Destination'});
    destination.focus();
    fireEvent.change(destination, {target: {value: 'alice@example.invalid'}});
    expect(destination).toHaveValue('alice@example.invalid');
    expect(destination).toHaveFocus();
  });
});
