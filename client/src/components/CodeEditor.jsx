import { memo, useCallback } from 'react';
import Editor from 'react-simple-code-editor';
import { highlight, languages } from 'prismjs/components/prism-core';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-sql';
import { autoPairEdit } from '../lib/autoPair.js';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const Ed = Editor.default || Editor;

// Apply an edit through the browser's own editing command so Ctrl+Z keeps working; fall back to a plain value update.
function applyEdit(ta, e, onChange) {
  ta.setSelectionRange(e.from, e.to);
  let ok = false;
  try {
    if (e.insert === '' && e.from === e.to) ok = true; // pure cursor move
    else if (e.insert === '') ok = document.execCommand('delete');
    else ok = document.execCommand('insertText', false, e.insert);
  } catch { ok = false; }
  if (!ok) {
    onChange(ta.value.slice(0, e.from) + e.insert + ta.value.slice(e.to));
    requestAnimationFrame(() => ta.setSelectionRange(e.selStart, e.selEnd));
    return;
  }
  ta.setSelectionRange(e.selStart, e.selEnd);
}

// Tab inserts 4 spaces (Shift+Tab outdents, Tab on a multi-line selection indents it); Enter keeps the indentation.
// Brackets and quotes auto-close like VS Code, closing characters step over, Backspace removes an empty pair, Enter between {} opens a block.
// Press Esc then Tab to move keyboard focus out of the editor.
function CodeEditor({ value, onChange, lang, highlightOn, disabled }) {
  const grammar = languages[lang];
  // Stable identity: the editor re-highlights only when the code, language or colour setting changes.
  const render = useCallback((code) => (highlightOn && grammar ? highlight(code, grammar, lang) : esc(code)), [highlightOn, grammar, lang]);
  const onKeyDown = useCallback((ev) => {
    if (ev.nativeEvent?.isComposing || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const ta = ev.target;
    const edit = autoPairEdit({ value: ta.value, start: ta.selectionStart, end: ta.selectionEnd, key: ev.key, lang });
    if (!edit) return;
    ev.preventDefault();
    applyEdit(ta, edit, onChange);
  }, [lang, onChange]);

  return (
    <div className="code-editor max-h-72 min-h-40 overflow-auto rounded border border-neutral-700 bg-neutral-950">
      <Ed
        value={value} onValueChange={onChange} highlight={render} disabled={disabled} onKeyDown={onKeyDown}
        tabSize={4} insertSpaces padding={10}
        placeholder="Paste or write your solution here…"
        textareaClassName="code-editor-ta"
        style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 13, minHeight: 160, color: '#e5e5e5' }}
      />
    </div>
  );
}

export default memo(CodeEditor);
