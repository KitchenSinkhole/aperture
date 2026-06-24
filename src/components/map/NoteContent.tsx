'use client';

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { remarkColorTags } from '@/lib/map/noteMarkdown';
import { cn } from '@/lib/utils';

// Rendered markdown for a map note's content — GFM via remark-gfm plus
// `[color]…[/color]` tags via remarkColorTags. Compact, size-inheriting element
// styling (the project has no Tailwind typography plugin), mirroring the
// ChangelogDialog markdown map but tuned for the small note surfaces.
const components: Components = {
  p: ({ children }) => <p className="leading-snug">{children}</p>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-primary underline underline-offset-2 hover:no-underline"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="ml-3.5 list-disc">{children}</ul>,
  ol: ({ children }) => <ol className="ml-3.5 list-decimal">{children}</ol>,
  li: ({ children }) => <li className="leading-snug">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  // Headings escalate by size so `## heading` reads distinctly from `**bold**`
  // (same body size, just heavier). h3+ falls back to a small-caps label since
  // the body is already small.
  h1: ({ children }) => (
    <h3 className="font-heading text-base font-bold leading-tight text-foreground">{children}</h3>
  ),
  h2: ({ children }) => (
    <h4 className="font-heading text-sm font-bold leading-tight text-foreground">{children}</h4>
  ),
  h3: ({ children }) => (
    <h5 className="font-heading text-xs font-semibold tracking-wide uppercase text-foreground">
      {children}
    </h5>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border pl-2 text-muted-foreground italic">
      {children}
    </blockquote>
  ),
  code: ({ children }) => (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">{children}</code>
  ),
  hr: () => <hr className="border-border" />,
};

/**
 * Renders a note's markdown `content` (GFM + colour tags). Blocks stack with a
 * small gap and no leading top margin so a clamped on-canvas snippet reads
 * cleanly; callers pass `className` for sizing/clamping (e.g. `line-clamp-2` on
 * the node snippet, full text in the tooltip / inspector preview).
 */
export function NoteContent({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <div className={cn('text-muted-foreground [&_*]:break-words [&>*+*]:mt-1', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkColorTags]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
