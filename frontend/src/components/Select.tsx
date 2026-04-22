import type { SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';

type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ children, className = '', ...rest }: SelectProps) {
  return (
    <div className="rd-select">
      <select {...rest} className={className}>
        {children}
      </select>
      <ChevronDown size={14} />
    </div>
  );
}
