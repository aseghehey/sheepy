// The right-click menu on a message: which items it has, and the text each
// copies. Plain functions, tested in test/menu.test.js.

// `selection`: the highlighted text in this message, if any; `quotable`: the
// message can be quoted into an annotation; `whole`: the message's own text.
export function messageMenu({ selection, quotable, whole }) {
  const items = [];
  const sel = (selection ?? "").trim();
  if (sel) {
    items.push({ id: "copy", label: "Copy" });
    if (quotable) items.push({ id: "quote", label: "Quote" });
  }
  if ((whole ?? "").trim()) {
    if (items.length) items.push({ id: "sep" });
    items.push({ id: "copy-message", label: "Copy Message" });
    if (quotable) items.push({ id: "quote-message", label: "Quote Message" });
  }
  return items;
}

// A view's text as a person would copy it: a block drawn from a fence (tool
// output, a code block) without the fence lines.
export function copyableText(text) {
  const t = String(text ?? "");
  const m = /^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n?\1\s*$/.exec(t);
  return (m ? m[2] : t).trim();
}
