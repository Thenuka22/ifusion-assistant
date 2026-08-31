"use client";

import { Fragment, type ReactNode } from "react";

/**
 * The small slice of markdown an assistant answer actually uses.
 *
 * This is a renderer rather than a parser library on purpose: answers are short, the package stays
 * dependency-free, and the set of elements that can ever be produced is fixed here. Nothing is
 * rendered as raw HTML, so nothing in an answer can inject markup — a tag in the text is text.
 */

const INLINE_PATTERN =
  /(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\))/g;

/** Only ordinary web links and in-app paths survive; anything else stays as plain text. */
function safeHref(href: string) {
  const value = href.trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return value;
  return null;
}

function renderInline(text: string, onOpenLink?: (href: string) => void): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  INLINE_PATTERN.lastIndex = 0;
  let match = INLINE_PATTERN.exec(text);
  while (match) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    key += 1;

    if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      nodes.push(
        <code key={key} className="assistant-md__code">
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("[")) {
      const split = token.indexOf("](");
      const label = token.slice(1, split);
      const href = safeHref(token.slice(split + 2, -1));
      nodes.push(
        href ? (
          <a
            key={key}
            href={href}
            rel="noopener noreferrer"
            target="_blank"
            onClick={
              onOpenLink
                ? (event) => {
                    event.preventDefault();
                    onOpenLink(href);
                  }
                : undefined
            }
            className="assistant-md__link"
          >
            {label}
          </a>
        ) : (
          label
        )
      );
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }

    lastIndex = match.index + token.length;
    match = INLINE_PATTERN.exec(text);
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

type Block =
  | { type: "paragraph"; lines: string[] }
  | { type: "bullets"; items: string[] }
  | { type: "numbers"; items: string[] }
  | { type: "table"; head: string[]; rows: string[][] };

function splitRow(line: string) {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableSeparator(line: string) {
  return /^\s*\|?[\s:-]*-[\s|:-]*\|?\s*$/.test(line) && line.includes("-");
}

function toBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (!line.trim()) {
      index += 1;
      continue;
    }

    // A table needs its header underline; without one the pipes are just text.
    if (line.trim().startsWith("|") && isTableSeparator(lines[index + 1] ?? "")) {
      const head = splitRow(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && (lines[index] ?? "").trim().startsWith("|")) {
        rows.push(splitRow(lines[index] ?? ""));
        index += 1;
      }
      blocks.push({ type: "table", head, rows });
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^\s*[-*+]\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "bullets", items });
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^\s*\d+[.)]\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "numbers", items });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && (lines[index] ?? "").trim() && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[index] ?? "")) {
      // Headings carry no extra weight in a chat bubble; the text is kept, the hashes are not.
      paragraph.push((lines[index] ?? "").replace(/^\s*#{1,6}\s+/, ""));
      index += 1;
    }
    blocks.push({ type: "paragraph", lines: paragraph });
  }

  return blocks;
}

export function Markdown({
  children,
  onOpenLink,
  className
}: {
  children: string;
  onOpenLink?: (href: string) => void;
  className?: string;
}) {
  const text = (children ?? "").trim();
  if (!text) return null;

  const blocks = toBlocks(text);

  return (
    <div className={className ? `assistant-md ${className}` : "assistant-md"}>
      {blocks.map((block, blockIndex) => {
        if (block.type === "bullets") {
          return (
            <ul key={blockIndex} className="assistant-md__list">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInline(item, onOpenLink)}</li>
              ))}
            </ul>
          );
        }

        if (block.type === "numbers") {
          return (
            <ol key={blockIndex} className="assistant-md__list assistant-md__list--ordered">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInline(item, onOpenLink)}</li>
              ))}
            </ol>
          );
        }

        if (block.type === "table") {
          return (
            <div key={blockIndex} className="assistant-md__table-wrap">
              <table className="assistant-md__table">
                <thead>
                  <tr>
                    {block.head.map((cell, cellIndex) => (
                      <th key={cellIndex}>{renderInline(cell, onOpenLink)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex}>{renderInline(cell, onOpenLink)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        return (
          <p key={blockIndex} className="assistant-md__p">
            {block.lines.map((line, lineIndex) => (
              <Fragment key={lineIndex}>
                {lineIndex > 0 ? " " : null}
                {renderInline(line, onOpenLink)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
