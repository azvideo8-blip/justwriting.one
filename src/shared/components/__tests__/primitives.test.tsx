import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '../Button';
import { Input } from '../Input';
import { Textarea } from '../Textarea';
import { Label } from '../Label';
import { FormField } from '../FormField';
import { Card } from '../Card';
import { Badge } from '../Badge';

vi.mock('../../../core/i18n', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'en' }),
}));

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click</Button>);
    expect(screen.getByRole('button', { name: 'Click' })).toBeInTheDocument();
  });

  it('has type="button" by default', () => {
    render(<Button>Click</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('is disabled when disabled prop is true', () => {
    render(<Button disabled>Click</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('is disabled when isLoading is true', () => {
    render(<Button isLoading>Click</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('shows spinner when isLoading', () => {
    render(<Button isLoading>Click</Button>);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

describe('Input', () => {
  it('renders with aria-invalid when error is provided', () => {
    render(<Input error="Invalid" />);
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid');
  });

  it('renders helper text', () => {
    render(<Input helperText="Hint" />);
    expect(screen.getByText('Hint')).toBeInTheDocument();
  });
});

describe('Textarea', () => {
  it('renders with aria-invalid when error is provided', () => {
    render(<Textarea error="Invalid" />);
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid');
  });
});

describe('Label', () => {
  it('renders children', () => {
    render(<Label>Email</Label>);
    expect(screen.getByText('Email')).toBeInTheDocument();
  });

  it('shows required asterisk', () => {
    render(<Label required>Email</Label>);
    expect(screen.getByText('*')).toBeInTheDocument();
  });
});

describe('FormField', () => {
  it('renders label and input', () => {
    render(
      <FormField label="Email" htmlFor="email" error="Required">
        <FormField.Input id="email" />
      </FormField>
    );
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Required');
  });
});

describe('Card', () => {
  it('renders children', () => {
    render(<Card>Content</Card>);
    expect(screen.getByText('Content')).toBeInTheDocument();
  });
});

describe('Badge', () => {
  it('renders children', () => {
    render(<Badge>New</Badge>);
    expect(screen.getByText('New')).toBeInTheDocument();
  });
});
