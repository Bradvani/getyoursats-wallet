import {afterEach, describe, expect, it, vi} from 'vitest';
import {render, screen, cleanup, fireEvent} from '@testing-library/react';
import {setAppLanguage, type AppLanguage} from '../../../services/presentationPreferences';
import {PAYMENT_EXPERIENCE} from '../../../locales/paymentExperience';
import ProcessingStep from './ProcessingStep';
import ResultStep from './ResultStep';

afterEach(() => {cleanup(); setAppLanguage('en');});
describe('payment state language', () => {
  it.each(Object.keys(PAYMENT_EXPERIENCE) as AppLanguage[])('renders processing and results in %s', language => {
    setAppLanguage(language);
    const text = PAYMENT_EXPERIENCE[language];
    const close = vi.fn();
    const view = render(<ProcessingStep />);
    expect(screen.getByRole('heading')).toHaveTextContent(text.sending);
    view.rerender(<ProcessingStep operationType="withdraw" />);
    expect(screen.getByRole('heading')).toHaveTextContent(text.receiving);
    view.rerender(<ProcessingStep processingPhase="converting" />);
    expect(screen.getByRole('heading')).toHaveTextContent(text.converting);
    view.rerender(<ResultStep result="success" error={null} onClose={close} />);
    expect(screen.getByRole('heading')).toHaveTextContent(text.sent);
    fireEvent.click(screen.getByRole('button', {name: text.done}));
    expect(close).toHaveBeenCalledOnce();
    view.rerender(<ResultStep result="failure" operationType="auth" error="Fixture error" onClose={close} />);
    expect(screen.getByRole('heading')).toHaveTextContent(text.authFailed);
    expect(screen.queryByText(text.authenticated)).toBeNull();
    expect(screen.getByText(text.errorDetails)).toBeInTheDocument();
  });
});
