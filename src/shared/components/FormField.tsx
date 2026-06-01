import React from 'react';
import { Label } from './Label';
import { Input } from './Input';
import { Textarea } from './Textarea';

interface FormFieldProps {
  label?: string;
  htmlFor?: string;
  required?: boolean;
  error?: string;
  helperText?: string;
  children?: React.ReactNode;
}

export function FormField({ label, htmlFor, required, error, helperText, children }: FormFieldProps) {
  return (
    <div className="w-full">
      {label && (
        <Label htmlFor={htmlFor} required={required}>{label}</Label>
      )}
      {children}
      {error && (
        <p className="mt-1 text-xs text-accent-danger" role="alert">{error}</p>
      )}
      {helperText && !error && (
        <p className="mt-1 text-xs text-text-subtle">{helperText}</p>
      )}
    </div>
  );
}

FormField.Input = Input;
FormField.Textarea = Textarea;
