import Paragraph from '@tiptap/extension-paragraph';

const attr = (name: string, data: string, dflt: unknown, keepOnSplit: boolean) => ({
  default: dflt,
  keepOnSplit,
  parseHTML: (el: HTMLElement) => (name === 'locked' ? el.getAttribute(data) === 'true' : (el.getAttribute(data) ?? dflt)),
  renderHTML: (a: Record<string, unknown>) => (a[name] && a[name] !== dflt ? { [data]: String(a[name]) } : {}),
});

/**
 * A story paragraph: the unit of authorship and of locking (design plan 3.2, 5.1).
 * A paragraph made by splitting another does NOT inherit id, author or lock: the stamper below gives it its own.
 */
export const StoryParagraph = Paragraph.extend({
  addAttributes() {
    return {
      paragraphId: attr('paragraphId', 'data-paragraph-id', null, false),
      authorId: attr('authorId', 'data-author', null, false),
      pov: attr('pov', 'data-pov', 'own', true),
      locked: attr('locked', 'data-locked', false, false),
    };
  },
});
