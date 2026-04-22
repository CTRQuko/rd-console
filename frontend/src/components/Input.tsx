import type { ComponentType, InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  leftIcon?: ComponentType<{ size?: number | string }>;
}

export function Input({ leftIcon: LeftIcon, className = '', ...rest }: InputProps) {
  if (LeftIcon) {
    return (
      <label className="rd-input rd-input--icon">
        <LeftIcon size={14} />
        <input {...rest} className={className} />
      </label>
    );
  }
  return <input {...rest} className={`rd-input ${className}`.trim()} />;
}
