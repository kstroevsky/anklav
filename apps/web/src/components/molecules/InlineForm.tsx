import type { ReactNode } from 'react';

export function InlineForm({ children, onSubmit, onCancel, pending }: { children: ReactNode; onSubmit: () => void; onCancel: () => void; pending: boolean }) { return <form className="inline-form" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>{children}<div><button className="button primary" disabled={pending}>Create</button><button type="button" className="button ghost" onClick={onCancel}>Cancel</button></div></form>; }
