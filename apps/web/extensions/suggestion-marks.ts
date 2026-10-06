import { Mark } from '@tiptap/core';
import { deletion, insertion, modification } from '@handlewithcare/prosemirror-suggest-changes';

/**
 * TipTap wrappers for the suggestion library's three marks. The library creates marks by name from the schema, so
 * all three must exist even though M2 only ever produces insertions and deletions (modification would come from
 * formatting or attribute changes, which this schema doesn't offer to other writers' text).
 */
function suggestionMark(name: 'insertion' | 'deletion' | 'modification', tag: string, extra: string[] = []) {
  const spec = { insertion, deletion, modification }[name];
  return Mark.create({
    name,
    inclusive: false,
    excludes: spec.excludes,
    addAttributes() {
      const attrs: Record<string, { default: null; parseHTML: (el: HTMLElement) => string | null; renderHTML: (a: Record<string, unknown>) => Record<string, string> }> = {};
      for (const key of ['id', ...extra]) {
        attrs[key] = {
          default: null,
          parseHTML: (el) => el.getAttribute(`data-${key}`),
          renderHTML: (a) => (a[key] == null ? {} : { [`data-${key}`]: String(a[key]) }),
        };
      }
      return attrs;
    },
    parseHTML: () => [{ tag }],
    renderHTML: ({ HTMLAttributes }) => [tag, HTMLAttributes, 0],
  });
}

export const Insertion = suggestionMark('insertion', 'ins');
export const Deletion = suggestionMark('deletion', 'del');
export const Modification = suggestionMark('modification', 'span[data-type=modification]', ['type', 'attrName', 'previousValue', 'newValue']);
