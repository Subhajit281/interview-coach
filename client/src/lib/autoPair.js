// VS Code-style bracket and quote handling as a pure function, so it can be tested without a browser.
// Returns null (let the editor handle the key) or an edit: replace [from, to) with `insert`, then select [selStart, selEnd].
const PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
const CLOSERS = new Set(Object.values(PAIRS));
const QUOTES = new Set(['"', "'", '`']);
const isWord = (c) => !!c && /[A-Za-z0-9_]/.test(c);
export const INDENT = '    ';

const lineStart = (value, pos) => value.lastIndexOf('\n', pos - 1) + 1;
const leadingSpace = (value, pos) => /^[ \t]*/.exec(value.slice(lineStart(value, pos)))[0];

export function autoPairEdit({ value, start, end, key, lang = 'plain' }) {
  const prev = value[start - 1];
  const next = value[start];
  const hasSel = start !== end;
  const edit = (from, to, insert, selStart, selEnd = selStart) => ({ from, to, insert, selStart, selEnd });

  if (key === 'Backspace') {
    if (!hasSel && prev && PAIRS[prev] === next) return edit(start - 1, start + 1, '', start - 1);
    return null;
  }

  if (key === 'Enter') {
    if (hasSel) return null;
    const indent = leadingSpace(value, start);
    const before = value.slice(lineStart(value, start), start).trimEnd();
    if (prev && '([{'.includes(prev) && PAIRS[prev] === next) {
      return edit(start, start, `\n${indent}${INDENT}\n${indent}`, start + 1 + indent.length + INDENT.length);
    }
    const opens = before && ('([{'.includes(before.slice(-1)) || (lang === 'python' && before.endsWith(':')));
    if (opens) {
      const ins = `\n${indent}${INDENT}`;
      return edit(start, end, ins, start + ins.length);
    }
    return null;
  }

  if (key.length !== 1) return null;
  if (lang === 'plain' && QUOTES.has(key)) return null;

  // Typing a closing character right before the same one just steps over it.
  if (!hasSel && CLOSERS.has(key) && next === key) return edit(start, start, '', start + 1);

  if (PAIRS[key]) {
    const close = PAIRS[key];
    if (hasSel) {
      const sel = value.slice(start, end);
      return edit(start, end, key + sel + close, start + 1, end + 1);
    }
    if (QUOTES.has(key)) {
      if (isWord(prev) || isWord(next) || prev === key) return null; // don't, it's, triple quotes
    } else if (next && !/[\s)\]}.,;:]/.test(next)) {
      return null;
    }
    return edit(start, end, key + close, start + 1);
  }
  return null;
}
