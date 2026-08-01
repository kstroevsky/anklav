import type { ReactNode } from 'react';

export function Callout({ title, children }: { title: string; children: ReactNode }) { return <aside className="callout"><strong>{title}</strong>{children}</aside>; }
