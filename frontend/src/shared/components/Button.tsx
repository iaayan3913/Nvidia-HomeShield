import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'quiet';
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: ReactNode;
}

export function Button({ variant = 'primary', icon, className = '', children, ...props }: ButtonProps) {
  return <button className={`button button--${variant} ${className}`.trim()} {...props}>{icon}{children}</button>;
}
