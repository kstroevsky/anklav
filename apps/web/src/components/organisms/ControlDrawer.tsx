import type { ReactNode } from 'react';

export function ControlDrawer({ eyebrow, title, close, children }: { eyebrow?: string; title: string; close: () => void; children: ReactNode }) {
  return <div className="drawer-backdrop" onMouseDown={close}><aside className="control-drawer" onMouseDown={(event) => event.stopPropagation()}><header><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2></div><button className="text-button" onClick={close}>Close</button></header>{children}</aside></div>;
}
