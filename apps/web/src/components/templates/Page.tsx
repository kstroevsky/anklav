import type { ReactNode } from 'react';

export function Page({ heading, subheading, action, children }: { heading: string; subheading: string; action?: ReactNode; children: ReactNode }) { return <div className="page"><header className="page-header"><div><span className="eyebrow">Anklav control room</span><h1>{heading}</h1><p>{subheading}</p></div><div className="page-action">{action}</div></header>{children}</div>; }
