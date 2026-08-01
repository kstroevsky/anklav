export function Error({ text }: { text: string }) { return text ? <p className="error">{text}</p> : null; }
