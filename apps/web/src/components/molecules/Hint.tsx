export function Hint({ title, text }: { title: string; text: string }) { return <div className="hint"><span>↗</span><h2>{title}</h2><p>{text}</p></div>; }
