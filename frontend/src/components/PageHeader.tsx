import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}

export function PageHeader({ title, subtitle, action }: PageHeaderProps) {
  return (
    <div className="rd-pageheader">
      <div>
        <h1 className="rd-pageheader__title">{title}</h1>
        {subtitle ? <div className="rd-pageheader__sub">{subtitle}</div> : null}
      </div>
      {action ? <div className="rd-pageheader__action">{action}</div> : null}
    </div>
  );
}
