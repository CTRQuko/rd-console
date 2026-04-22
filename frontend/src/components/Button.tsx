import type { ButtonHTMLAttributes, CSSProperties, ComponentType, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: Variant;
  size?: Size;
  icon?: ComponentType<{ size?: number | string; className?: string }>;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  children,
  className = '',
  type = 'button',
  ...rest
}: ButtonProps) {
  const cls = `rd-btn rd-btn--${variant} rd-btn--${size} ${className}`.trim();
  return (
    <button type={type} className={cls} {...rest}>
      {Icon ? <Icon size={14} /> : null}
      {children}
    </button>
  );
}
