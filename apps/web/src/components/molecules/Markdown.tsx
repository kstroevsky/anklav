import { useMemo } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

export function Markdown({ value }: { value: string }) { const html = useMemo(() => DOMPurify.sanitize(marked.parse(value || '') as string), [value]); return value ? <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} /> : null; }
