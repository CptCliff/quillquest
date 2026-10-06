import { fromPmJson, type StoryDoc } from '@quillquest/story';
import type { Node } from '@tiptap/pm/model';

/** The policy's view of an editor document. */
export const snapshot = (doc: Node): StoryDoc => fromPmJson(doc.toJSON());
