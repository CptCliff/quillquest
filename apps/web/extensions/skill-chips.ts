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
  /**
   * Claude's half of the chip (design plan 5.3): asked only after the writer pauses on a first-person sentence the code matcher could not
   * place. It resolves to one of the writer's own Skills or null; the answer shows as a dashed chip until the writer taps it.
   */
  suggest?: (sentence: string) => Promise<string | null>;
}

interface ChipState { dismissed: Set<string>; accepted: Map<string, string> }
type ChipMeta = { type: 'dismiss'; key: string } | { type: 'accept'; key: string; skill: string } | { type: 'refresh' };
const chipKey = new PluginKey<ChipState>('skillChips');
const PAUSE_MS = 1200;
/** Worth asking Claude about: a first-person sentence of a few words. */
const looksLikeAction = (s: string) => /^\s*(i|we)\b/i.test(s) && s.trim().split(/\s+/).length >= 3;

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
    const cache = new Map<string, string | null>(); // sentence key -> Claude's answer
    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;

    /** The sentence the writer is in, if it is theirs to chip: their own, unlocked paragraph. */
    const here = (state: import('@tiptap/pm/state').EditorState) => {
      const { $from, empty } = state.selection;
      if (!empty || $from.depth < 1) return null;
      const para = $from.node(1);
      const mine = !para.attrs.authorId || para.attrs.authorId === opts.userId;
      if (!mine || para.attrs.locked) return null;
      const sentence = sentenceAt(para.textContent, $from.parentOffset);
      if (!sentence) return null;
      const id = String(para.attrs.paragraphId ?? '');
      return { para, sentence, id, key: `${id}:${sentence.text}`, at: $from.start() + sentence.end };
    };

    return [
      new Plugin<ChipState>({
        key: chipKey,
        state: {
          init: () => ({ dismissed: new Set<string>(), accepted: new Map<string, string>() }),
          apply(tr, s) {
            const m = tr.getMeta(chipKey) as ChipMeta | undefined;
            if (!m || m.type === 'refresh') return s;
            if (m.type === 'dismiss') return { ...s, dismissed: new Set(s.dismissed).add(m.key) };
            return { ...s, accepted: new Map(s.accepted).set(m.key, m.skill) };
          },
        },
        view() {
          return {
            update(view) {
              if (!opts.suggest) return;
              const h = here(view.state);
              if (timer) clearTimeout(timer);
              if (!h || cache.has(h.key) || pending.has(h.key) || !looksLikeAction(h.sentence.text) || matchSkillChip(h.sentence.text, opts.getSkills())) return;
              const { key, sentence } = h;
              timer = setTimeout(() => {
                pending.add(key);
                opts.suggest!(sentence.text).then((skill) => skill, () => null).then((skill) => {
                  pending.delete(key);
                  cache.set(key, skill);
                  if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(chipKey, { type: 'refresh' } satisfies ChipMeta));
                });
              }, PAUSE_MS);
            },
            destroy() { if (timer) clearTimeout(timer); },
          };
        },
        props: {
          decorations(state) {
            const h = here(state);
            if (!h) return null;
            const s = chipKey.getState(state)!;
            if (s.dismissed.has(h.key)) return null;
            const code = matchSkillChip(h.sentence.text, opts.getSkills());
            const accepted = s.accepted.get(h.key);
            const guess = !code && !accepted ? cache.get(h.key) : null;
            const skill = code?.skill ?? accepted ?? guess ?? null;
            if (!skill) return null;
            const rank = code?.rank ?? opts.getSkills().find((k) => k.name === skill)?.rank;
            if (!rank) return null; // never show a Skill that is not on the sheet
            const suggested = !code && !accepted;
            return DecorationSet.create(state.doc, [
              Decoration.widget(h.at, (view) => {
                const root = document.createElement('span');
                root.className = `skill-chip${suggested ? ' suggested' : ''}`;
                root.contentEditable = 'false';
                root.dataset.testid = suggested ? 'skill-chip-suggested' : 'skill-chip';
                root.dataset.skill = skill;
                // Keep the editor's caret where it is when a chip button is pressed.
                root.addEventListener('mousedown', (e) => e.preventDefault());
                const button = (label: string, cls: string, testid: string, click: () => void, aria?: string) => {
                  const b = document.createElement('button');
                  b.type = 'button'; b.className = cls; b.textContent = label; b.dataset.testid = testid;
                  if (aria) b.setAttribute('aria-label', aria);
                  b.addEventListener('click', click);
                  root.appendChild(b);
                };
                if (suggested) {
                  button(`${skill} · ${rank}?`, 'chip-main', 'chip-accept', () => view.dispatch(view.state.tr.setMeta(chipKey, { type: 'accept', key: h.key, skill } satisfies ChipMeta)), `Claude suggests ${skill}. Tap to use it.`);
                } else {
                  button(`${skill} · ${rank}`, 'chip-main', 'chip-info', () => opts.onInfo(skill));
                  button('Roll', 'chip-roll', 'chip-roll', () => opts.onRoll(skill, h.id || null));
                }
                button('×', 'chip-x', 'chip-dismiss', () => view.dispatch(view.state.tr.setMeta(chipKey, { type: 'dismiss', key: h.key } satisfies ChipMeta)), 'Hide this chip');
                return root;
              }, { side: 1, key: `chip:${h.key}:${skill}:${rank}:${suggested ? 's' : 'm'}` }),
            ]);
          },
        },
      }),
    ];
  },
});
