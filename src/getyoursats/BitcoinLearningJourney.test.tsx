import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import BitcoinLearningJourney from './BitcoinLearningJourney';
import {bitcoinLearningScope, clearBitcoinLearningMemory, offerBitcoinLearning, useBitcoinLearning} from './bitcoinLearningState';
import {walletSetupScope} from './walletSetupState';
import {APP_LANGUAGES, setAppLanguage} from '../services/presentationPreferences';
import {bitcoinLearningCopy} from '../locales/bitcoinLearning';

vi.mock('../locales/loadFonts', () => ({loadLocaleFonts: vi.fn(async () => {})}));

const wallet = walletSetupScope('02' + 'a'.repeat(64), 'mainnet')!;
const scope = bitcoinLearningScope(wallet)!;

function Harness({onReviewRecovery = vi.fn(), onOpenWallet = vi.fn(), paused = false}: {
  onReviewRecovery?: () => void; onOpenWallet?: () => void; paused?: boolean;
}) {
  const learning = useBitcoinLearning(wallet);
  return <BitcoinLearningJourney learning={learning}
    onReviewRecovery={onReviewRecovery} onOpenWallet={onOpenWallet} paused={paused}/>;
}

beforeEach(() => {
  localStorage.clear();
  clearBitcoinLearningMemory();
  setAppLanguage('en');
});
afterEach(() => {
  cleanup();
  setAppLanguage('en');
  clearBitcoinLearningMemory();
});

describe('first-wallet Bitcoin introduction', () => {
  it('does not open before the wallet is created or after the user skips', () => {
    const view = render(<Harness/>);
    expect(screen.queryByTestId('bitcoin-learning-journey')).toBeNull();
    act(() => offerBitcoinLearning(scope));
    expect(screen.getByRole('dialog')).toBeVisible();
    fireEvent.click(screen.getByTestId('bitcoin-learning-experienced'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).not.toBe('hidden');
    view.unmount();
  });

  it('invites beginners but does not take away the wallet from an expert', () => {
    const onOpenWallet = vi.fn();
    act(() => offerBitcoinLearning(scope));
    render(<Harness onOpenWallet={onOpenWallet}/>);
    expect(screen.getByRole('heading',{name:'Your wallet is ready.'})).toBeVisible();
    expect(screen.getByText('About 2 minutes · At your own pace')).toBeVisible();
    fireEvent.click(screen.getByTestId('bitcoin-learning-experienced'));
    expect(onOpenWallet).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('bitcoin-learning-journey')).toBeNull();
  });

  it('teaches keys with a real comprehension question, not just a checkbox', () => {
    act(() => offerBitcoinLearning(scope));
    render(<Harness/>);
    fireEvent.click(screen.getByTestId('bitcoin-learning-start'));
    expect(screen.getByTestId('bitcoin-learning-journey')).toHaveAttribute('data-learning-chapter','mission');
    for(let i=0;i<6;i++) fireEvent.click(screen.getByTestId('bitcoin-learning-next'));
    expect(screen.getByTestId('bitcoin-learning-journey')).toHaveAttribute('data-learning-chapter','keys');
    expect(screen.getByRole('button',{name:/Next/})).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:/Your private key/}));
    expect(screen.getByText(/could steal your funds/)).toBeVisible();
    expect(screen.getByTestId('bitcoin-learning-next')).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:/Your receiving address/}));
    expect(screen.getByText(/Receiving addresses are meant to be shared/)).toBeVisible();
    expect(screen.getByTestId('bitcoin-learning-next')).toBeEnabled();
    fireEvent.click(screen.getByTestId('bitcoin-learning-next'));
    expect(screen.getByTestId('bitcoin-learning-journey')).toHaveAttribute('data-learning-chapter','recovery');
  });

  it('reviewing a backup opens the existing security ceremony, never marks it verified', () => {
    const onReviewRecovery = vi.fn();
    act(() => offerBitcoinLearning(scope));
    render(<Harness onReviewRecovery={onReviewRecovery}/>);
    fireEvent.click(screen.getByTestId('bitcoin-learning-start'));
    for(let i=0;i<6;i++) fireEvent.click(screen.getByTestId('bitcoin-learning-next'));
    fireEvent.click(screen.getByRole('button',{name:/Your receiving address/}));
    fireEvent.click(screen.getByTestId('bitcoin-learning-next'));
    expect(screen.getByText('Learning this lesson does not verify your recovery backup.')).toBeVisible();
    fireEvent.click(screen.getByTestId('bitcoin-learning-review-backup'));
    expect(onReviewRecovery).toHaveBeenCalledOnce();
    expect(screen.getByTestId('bitcoin-learning-journey')).toHaveAttribute('data-learning-chapter','recovery');
  });

  it('hides under a wallet-critical action and can be resumed without losing progress', () => {
    act(() => offerBitcoinLearning(scope));
    const view = render(<Harness/>);
    fireEvent.click(screen.getByTestId('bitcoin-learning-start'));
    fireEvent.click(screen.getByTestId('bitcoin-learning-next'));
    expect(screen.getByTestId('bitcoin-learning-journey')).toHaveAttribute('data-learning-chapter','supply');
    view.rerender(<Harness paused/>);
    expect(screen.queryByTestId('bitcoin-learning-journey')).toBeNull();
    view.rerender(<Harness/>);
    expect(screen.getByTestId('bitcoin-learning-journey')).toHaveAttribute('data-learning-chapter','supply');
  });

  it.each(APP_LANGUAGES)('renders all ten meaningful lessons in $code and correct direction', ({code}) => {
    setAppLanguage(code);
    act(() => offerBitcoinLearning(scope));
    const view = render(<Harness/>);
    const copy = bitcoinLearningCopy(code);
    expect(screen.getByRole('heading',{name:copy.welcome})).toBeVisible();
    expect(screen.getByRole('dialog')).toHaveAttribute('dir',code === 'ar'?'rtl':'ltr');
    fireEvent.click(screen.getByTestId('bitcoin-learning-start'));
    expect(screen.getByRole('heading',{name:copy.chapters.mission.title})).toBeVisible();
    expect(Object.keys(copy.chapters)).toHaveLength(10);
    view.unmount();
  });
});
