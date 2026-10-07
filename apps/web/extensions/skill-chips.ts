import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { matchSkillChip, sentenceAt, type Skill } from '@quillquest/rules';

export interface SkillChipsOptions {
  userId: string;
  /** The writer's own Skills, read from their sheet each time: the rank on a chip is never guessed. */
  getSkills: () => Skill[];
  onInfo: (skill: string) => void;
  /** Open a roll with this Skill. Only ever called by the writer tapping the chip. */
  onRoll: (skill: string, paragraphId: string | null) => void;
}

const dismissals = new PluginKey<Set<string>>('skillChipDismissals');

/**
 * Skill chips, code first (design plan 5.3): while you write in your own unlocked paragraph, the sentence you are in is
 * checked against your sheet's Skills (names and common forms). A match shows a solid chip at once, `Sneak · Expert`.
 * Tapping the name opens its info card, "Roll" opens a card with that Skill, and the cross hides it until the sentence
 * changes. A chip never starts a roll by itself and never touches the text.
 */
export const SkillChips = Extension.create<SkillChipsOptions>({
  name: 'skillChips',

  addOptions() {
    return { userId: '', getSkills: () => [], onInfo: () => {}, onRoll: () => {} };
  },

  addProseMirrorPlugins() {
    const opts = this.options;
    return [
      new Plugin<Set<string>>({
        key: dismissals,
        state: {
          init: () => new Set<string>(),
          apply(tr, set) {
            const add = tr.getMeta(dismissals) as string | undefined;
            if (!add) return set;
            return new Set(set).add(add);
          },
        },
        props: {
          decorations(state) {
            const { $from, empty } = state.selection;
            if (!empty || $from.depth < 1) return null;
            const para = $from.node(1);
            const mine = !para.attrs.authorId || para.attrs.authorId === opts.userId;
            if (!mine || para.attrs.locked) return null;
            const sentence = sentenceAt(para.textContent, $from.parentOffset);
            if (!sentence) return null;
            const match = matchSkillChip(sentence.text, opts.getSkills());
            if (!match) return null;
            const id = String(para.attrs.paragraphId ?? '');
            const key = `${id}:${sentence.text}`;
            if (dismissals.getState(state)?.has(key)) return null;
            const at = $from.start() + sentence.end;
            return DecorationSet.create(state.doc, [
              Decoration.widget(at, (view) => {
                const root = document.createElement('span');
                root.className = 'skill-chip';
                root.contentEditable = 'false';
                root.dataset.testid = 'skill-chip';
                root.dataset.skill = match.skill;
                // Keep the editor's caret where it is when a chip button is pressed.
                root.addEventListener('mousedown', (e) => e.preventDefault());
                const button = (label: string, cls: string, testid: string, click: () => void, aria?: string) => {
                  const b = document.createElement('button');
                  b.type = 'button'; b.className = cls; b.textContent = label; b.dataset.testid = testid;
                  if (aria) b.setAttribute('aria-label', aria);
                  b.addEventListener('click', click);
                  root.appendChild(b);
                };
                button(`${match.skill} · ${match.rank}`, 'chip-main', 'chip-info', () => opts.onInfo(match.skill));
                button('Roll', 'chip-roll', 'chip-roll', () => opts.onRoll(match.skill, id || null));
                button('×', 'chip-x', 'chip-dismiss', () => view.dispatch(view.state.tr.setMeta(dismissals, key)), 'Hide this chip');
                return root;
              }, { side: 1, key: `chip:${key}:${match.skill}:${match.rank}` }),
            ]);
          },
        },
      }),
    ];
  },
});
