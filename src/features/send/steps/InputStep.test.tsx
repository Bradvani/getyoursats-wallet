import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {Contact} from '@breeztech/breez-sdk-spark';
import type {ComponentProps} from 'react';
import InputStep from './InputStep';
import {dismissKeyboard} from '@/utils/keyboard';

const state = vi.hoisted(() => ({contacts: [] as Contact[]}));
vi.mock('@/contexts/ContactsContext', () => ({useContactsContext: () => ({contacts: state.contacts})}));
vi.mock('@/utils/keyboard', () => ({dismissKeyboard: vi.fn().mockResolvedValue(undefined)}));

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
beforeEach(() => {state.contacts = [];});
afterEach(() => {
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

function setup(props: Partial<ComponentProps<typeof InputStep>> = {}) {
  const onContinue = vi.fn();
  const onClearError = vi.fn();
  render(<InputStep paymentInput="" isLoading={false} error={null} onContinue={onContinue} onClearError={onClearError} {...props}/>);
  return {onContinue, onClearError, input: screen.getByTestId('payment-input')};
}

describe('visible username completion', () => {
  it.each(['Continue', 'Enter'])('shows the full destination before %s submits a bare username', async action => {
    const {input, onContinue} = setup();
    fireEvent.change(input, {target: {value: 'shiv'}});
    expect(screen.getByRole('button', {name: 'Use address shiv@getyoursats.com'})).toBeVisible();
    expect(onContinue).not.toHaveBeenCalled();
    if (action === 'Continue') fireEvent.click(screen.getByTestId('continue-button'));
    else fireEvent.keyDown(input, {key: 'Enter'});
    await waitFor(() => expect(onContinue).toHaveBeenCalledExactlyOnceWith('shiv@getyoursats.com'));
    expect(input).toHaveValue('shiv@getyoursats.com');
  });

  it('accepts a visible suggestion without advancing or parsing', async () => {
    const {input, onContinue, onClearError} = setup();
    fireEvent.change(input, {target: {value: 'Shiv'}});
    fireEvent.click(screen.getByTestId('username-destination'));
    expect(input).toHaveValue('shiv@getyoursats.com');
    expect(onContinue).not.toHaveBeenCalled();
    expect(onClearError).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('username-destination')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('continue-button'));
    await waitFor(() => expect(onContinue).toHaveBeenCalledExactlyOnceWith('shiv@getyoursats.com'));
  });

  it.each(['Paste', 'field paste'])('keeps a bare username on entry after %s until its displayed address is accepted', async action => {
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {readText: vi.fn().mockResolvedValue('shiv')}});
    const {input, onContinue} = setup();
    if (action === 'Paste') fireEvent.click(screen.getByRole('button', {name: 'Paste'}));
    else fireEvent.paste(input, {clipboardData: {getData: () => 'shiv'}});
    expect(await screen.findByTestId('username-destination')).toHaveTextContent('shiv@getyoursats.com');
    expect(onContinue).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('continue-button'));
    await waitFor(() => expect(onContinue).toHaveBeenCalledExactlyOnceWith('shiv@getyoursats.com'));
  });

  it.each(['alice@other.example', 'LNBC1SHORT', 'bitcoin:bc1short', 'spark1short', 'sp1short', 'https://example.com/pay'])('submits an existing payment format unchanged: %s', async destination => {
    const {input, onContinue} = setup();
    fireEvent.change(input, {target: {value: destination}});
    expect(screen.queryByTestId('username-destination')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('continue-button'));
    await waitFor(() => expect(onContinue).toHaveBeenCalledExactlyOnceWith(destination));
  });

  it.each(['Paste', 'field paste'])('retains the explicit review gate for a formatted %s', async action => {
    const destination = 'lnbc1synthetic';
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {readText: vi.fn().mockResolvedValue(destination)}});
    const {input, onContinue} = setup();
    if (action === 'Paste') fireEvent.click(screen.getByRole('button', {name: 'Paste'}));
    else fireEvent.paste(input, {clipboardData: {getData: () => destination}});
    await waitFor(() => expect(onContinue).toHaveBeenCalledExactlyOnceWith(destination, {requireReview: true}));
    expect(screen.queryByTestId('username-destination')).not.toBeInTheDocument();
  });

  it('keeps a matching external contact separate from the username completion', async () => {
    state.contacts = [{id: 'contact-shiv', name: 'Shiv', paymentIdentifier: 'shiv@other.example', createdAt: 1, updatedAt: 1}];
    const {input, onContinue} = setup();
    fireEvent.focus(input);
    fireEvent.change(input, {target: {value: 'shiv'}});
    const completion = screen.getByTestId('username-destination');
    const contact = screen.getByRole('button', {name: /Shiv shiv@other\.example$/});
    expect(completion).toBeVisible();
    expect(completion).toHaveTextContent('shiv@getyoursats.com');
    expect(contact).toBeVisible();
    expect(completion.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(contact);
    expect(screen.queryByTestId('username-destination')).not.toBeInTheDocument();
    expect(screen.getByText('shiv@other.example')).toBeVisible();
    fireEvent.click(screen.getByTestId('continue-button'));
    await waitFor(() => expect(onContinue).toHaveBeenCalledExactlyOnceWith('shiv@other.example'));
  });

  it.each(['Bitcoin', 'USDT / USDC'])('preserves a short destination when %s is chosen', async rail => {
    const {input, onContinue} = setup();
    fireEvent.click(screen.getByRole('button', {name: rail}));
    fireEvent.change(input, {target: {value: 'shiv'}});
    expect(screen.queryByTestId('username-destination')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('continue-button'));
    await waitFor(() => expect(onContinue).toHaveBeenCalledExactlyOnceWith('shiv'));
  });

  it('cancels an older pending Continue when the user accepts the completion', async () => {
    let resolve!: () => void;
    vi.mocked(dismissKeyboard).mockReturnValueOnce(new Promise<void>(done => {resolve = done;}));
    const {input, onContinue} = setup();
    fireEvent.change(input, {target: {value: 'shiv'}});
    fireEvent.click(screen.getByTestId('continue-button'));
    fireEvent.click(screen.getByTestId('username-destination'));
    await act(async () => resolve());
    expect(onContinue).not.toHaveBeenCalled();
    expect(input).toHaveValue('shiv@getyoursats.com');
  });

  it('cancels an older clipboard read when the user accepts the completion', async () => {
    let resolve!: (text: string) => void;
    const pending = new Promise<string>(done => {resolve = done;});
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {readText: () => pending}});
    const {input, onContinue} = setup();
    fireEvent.change(input, {target: {value: 'shiv'}});
    fireEvent.click(screen.getByRole('button', {name: 'Paste'}));
    fireEvent.click(screen.getByTestId('username-destination'));
    await act(async () => resolve('old@example.invalid'));
    expect(input).toHaveValue('shiv@getyoursats.com');
    expect(onContinue).not.toHaveBeenCalled();
  });
});
