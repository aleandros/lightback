import MagicString from 'magic-string';

/** Insert after the last parsed attribute, without scanning expressions for closing >. */
export function stampTemplate(code: string, file: string) {
  const output = new MagicString(code);
  const lineStarts = [0];
  for (let i = 0; i < code.length; i++) if (code[i] === '\n') lineStarts.push(i + 1);
  return {
    add(start: number, insert: number) {
      let low = 0, high = lineStarts.length;
      while (low + 1 < high) {
        const mid = (low + high) >>> 1;
        if (lineStarts[mid]! <= start) low = mid; else high = mid;
      }
      const location = `${file}:${low + 1}:${start - lineStarts[low]! + 1}`;
      // HTML-encode braces too: Svelte treats literal braces as expression delimiters.
      const value = location.replace(/[&"<>\r\n{}]/g, (c) => `&#${c.charCodeAt(0)};`);
      output.appendLeft(insert, ` data-source="${value}"`);
    },
    result() {
      return { code: output.toString(), map: output.generateMap({ hires: true, source: file.slice(file.lastIndexOf('/') + 1), includeContent: true }) };
    },
  };
}
