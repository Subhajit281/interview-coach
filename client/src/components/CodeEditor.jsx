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

function applyEdit(ta, e, onChange) {
  ta.setSelectionRange(e.from, e.to);
  let ok = false;
  try {
    if (e.insert === '' && e.from === e.to) ok = true;
    else if (e.insert === '') ok = document.execCommand('delete');
    else ok = document.execCommand('insertText', false, e.insert);
  } catch {
    ok = false;
  }
  if (!ok) {
    onChange(ta.value.slice(0, e.from) + e.insert + ta.value.slice(e.to));
    requestAnimationFrame(() => ta.setSelectionRange(e.selStart, e.selEnd));
    return;
  }
  ta.setSelectionRange(e.selStart, e.selEnd);
}

function CodeEditor({ value, onChange, lang, highlightOn, disabled }) {
  const grammar = languages[lang];
  const render = useCallback(
    (code) => (highlightOn && grammar ? highlight(code, grammar, lang) : esc(code)),
    [highlightOn, grammar, lang]
  );

  const onKeyDown = useCallback(
    (ev) => {
      if (ev.nativeEvent?.isComposing || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const ta = ev.target;
      const edit = autoPairEdit({ value: ta.value, start: ta.selectionStart, end: ta.selectionEnd, key: ev.key, lang });
      if (!edit) return;
      ev.preventDefault();
      applyEdit(ta, edit, onChange);
    },
    [lang, onChange]
  );

  return (
    <div className="code-editor max-h-80 min-h-44 overflow-auto rounded-[6px] border border-[#1b2b20] bg-[#070b08] focus-within:border-emerald-500/70 focus-within:ring-1 focus-within:ring-emerald-500/30 transition-all">
      <Ed
        value={value}
        onValueChange={onChange}
        highlight={render}
        disabled={disabled}
        onKeyDown={onKeyDown}
        tabSize={4}
        insertSpaces
        padding={12}
        placeholder="// Write or paste your code solution here..."
        textareaClassName="code-editor-ta"
        style={{
          fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 13,
          minHeight: 176,
          color: '#e2e8f0',
          lineHeight: '1.6',
        }}
      />
    </div>
  );
}

export default memo(CodeEditor);
