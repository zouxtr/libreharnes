import * as React from "react";
import { Check, Copy } from "lucide-react";

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-i${i++}`;
    if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(
        <strong key={key} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code
          key={key}
          className="rounded bg-secondary px-1 py-0.5 font-mono text-[0.92em] text-foreground"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link) {
        nodes.push(
          <a
            key={key}
            href={link[2]}
            target="_blank"
            rel="noreferrer"
            className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
          >
            {link[1]}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="my-3 overflow-hidden rounded-lg border border-border bg-[hsl(var(--background))]">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
          {lang || "code"}
        </span>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {copied ? (
            <Check className="h-3 w-3" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[12px] leading-relaxed text-foreground">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function TextBlock({ text, blockKey }: { text: string; blockKey: string }) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const joined = paragraph.join("\n");
    blocks.push(
      <p key={`${blockKey}-p${blocks.length}`} className="my-2 first:mt-0 last:mb-0">
        {renderInline(joined, `${blockKey}-p${blocks.length}`)}
      </p>,
    );
    paragraph = [];
  };

  const flushList = () => {
    if (!list) return;
    const items = list.items.map((item, idx) => (
      <li key={`${blockKey}-li${idx}`} className="pl-1">
        {renderInline(item, `${blockKey}-li${idx}`)}
      </li>
    ));
    blocks.push(
      list.ordered ? (
        <ol key={`${blockKey}-ol${blocks.length}`} className="my-2 list-decimal space-y-1 pl-5">
          {items}
        </ol>
      ) : (
        <ul key={`${blockKey}-ul${blocks.length}`} className="my-2 list-disc space-y-1 pl-5">
          {items}
        </ul>
      ),
    );
    list = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      const sizes = ["text-[17px]", "text-[15.5px]", "text-[14.5px]", "text-[13.5px]"];
      blocks.push(
        <div
          key={`${blockKey}-h${blocks.length}`}
          className={`mb-2 mt-4 font-semibold text-foreground first:mt-0 ${sizes[level - 1]}`}
        >
          {renderInline(heading[2], `${blockKey}-h${blocks.length}`)}
        </div>,
      );
      continue;
    }
    const bullet = trimmed.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1]);
      continue;
    }
    const ordered = trimmed.match(/^\d+\.\s+(.*)$/);
    if (ordered) {
      flushParagraph();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(ordered[1]);
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return <>{blocks}</>;
}

export function Markdown({ content }: { content: string }) {
  const segments = content.split(/```/);
  const nodes: React.ReactNode[] = [];
  segments.forEach((segment, index) => {
    if (index % 2 === 1) {
      const newline = segment.indexOf("\n");
      const lang = newline >= 0 ? segment.slice(0, newline).trim() : "";
      const code = newline >= 0 ? segment.slice(newline + 1) : segment;
      nodes.push(<CodeBlock key={`code-${index}`} code={code.replace(/\n$/, "")} lang={lang} />);
    } else if (segment.trim()) {
      nodes.push(<TextBlock key={`text-${index}`} text={segment} blockKey={`t${index}`} />);
    }
  });
  return <div className="text-[13.5px] leading-[1.7] text-foreground/90">{nodes}</div>;
}
