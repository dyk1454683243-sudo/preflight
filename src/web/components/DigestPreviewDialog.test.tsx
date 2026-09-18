import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DigestPreviewDialog } from './DigestPreviewDialog';

const BASE_PROPS = {
  week: '2026-W38',
  text: 'Weekly AI Coding Summary\n\nTotal Cost:\n$1.2300',
  loading: false,
  error: null,
  canSend: true,
  sending: false,
  onClose: () => {},
  onSend: () => {},
};

describe('DigestPreviewDialog', () => {
  it('renders nothing when open is false', () => {
    const { container } = render(<DigestPreviewDialog open={false} {...BASE_PROPS} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the plain-text preview when open', () => {
    render(<DigestPreviewDialog open={true} {...BASE_PROPS} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Digest preview')).toBeInTheDocument();
    expect(screen.getByText('2026-W38')).toBeInTheDocument();
    expect(screen.getByText(/Weekly AI Coding Summary/)).toBeInTheDocument();
    expect(screen.getByText(/\$1\.2300/)).toBeInTheDocument();
  });

  it('calls onClose when Escape is pressed while open', () => {
    const onClose = vi.fn();
    render(<DigestPreviewDialog open={true} {...BASE_PROPS} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onSend from the Send now action', () => {
    const onSend = vi.fn();
    render(<DigestPreviewDialog open={true} {...BASE_PROPS} onSend={onSend} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }));
    expect(onSend).toHaveBeenCalled();
  });
});
