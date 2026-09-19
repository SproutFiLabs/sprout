import type { ReactNode } from "react";

/** A small text-only formatter. Model output never becomes raw HTML. */
function emphasis(text: string): ReactNode {
  return text
    .split(/(\*\*[^*\n]+\*\*)/g)
    .map((part, index) =>
      part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
        <strong key={index}>{part.slice(2, -2)}</strong>
      ) : (
        part
      ),
    );
}

export function AnswerText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (!line.trim()) {
      index++;
      continue;
    }
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      blocks.push(<h3 key={index}>{emphasis(heading[1]!)}</h3>);
      index++;
      continue;
    }
    const ordered = /^\d+[.)]\s+/.test(line);
    const bullet = /^[-*]\s+/.test(line);
    if (ordered || bullet) {
      const pattern = ordered ? /^\d+[.)]\s+/ : /^[-*]\s+/;
      const start = index;
      const items: ReactNode[] = [];
      while (index < lines.length) {
        if (!lines[index]!.trim()) {
          let next = index + 1;
          while (next < lines.length && !lines[next]!.trim()) next++;
          if (next < lines.length && pattern.test(lines[next]!)) index = next;
          else break;
        }
        if (!pattern.test(lines[index]!)) break;
        let content = lines[index]!.replace(pattern, "");
        index++;
        while (index < lines.length && /^\s{2,}\S/.test(lines[index]!)) {
          content += "\n" + lines[index]!.trim();
          index++;
        }
        items.push(<li key={index}>{emphasis(content)}</li>);
      }
      blocks.push(
        ordered ? (
          <ol key={start} start={parseInt(line, 10)}>
            {items}
          </ol>
        ) : (
          <ul key={start}>{items}</ul>
        ),
      );
      continue;
    }
    const start = index;
    const paragraph = [line];
    index++;
    while (
      index < lines.length &&
      lines[index]!.trim() &&
      !/^(?:#{1,6}\s|\d+[.)]\s|[-*]\s)/.test(lines[index]!)
    ) {
      paragraph.push(lines[index]!);
      index++;
    }
    blocks.push(<p key={start}>{emphasis(paragraph.join("\n"))}</p>);
  }
  return <>{blocks}</>;
}
