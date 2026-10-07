// The words the game uses, in plain language (Rules v4; "define in the player text before the playtest", section 14).
// Wording follows the rules; no dice or numbers appear here.

export interface GlossaryEntry { term: string; text: string; group: 'Making a character' | 'Rolling' | 'Beliefs and what they cost' | 'The table' }

export const GLOSSARY = {
  origin: { group: 'Making a character', term: 'Origin', text: 'Where your character comes from: one short paragraph in the Story. It gives you one Skill at Trained and a first Connection.' },
  chapter: { group: 'Making a character', term: 'Life Chapter', text: 'A stretch of your character\'s past: one paragraph and a one-line summary. Each one earns a Skill and a Trait, and leaves you a Connection, a Resource or a Thread. You write three.' },
  badChapter: { group: 'Making a character', term: 'The bad chapter', text: 'One chapter, never the first or the most recent, that ended badly. It must leave a Thread and a harmful Trait.' },
  crossing: { group: 'Making a character', term: 'Crossing paths', text: 'A short scene where your past meets another character\'s. Each crossing gives both of you a Connection. You need two.' },
  capital: { group: 'Making a character', term: 'Capital', text: 'What you have and how you are seen: your Wealth, your Network, how communities see you (Standing), and up to three significant possessions.' },
  canon: { group: 'The table', term: 'Canon', text: 'Facts the whole table has agreed are true in this world. Later writers must not contradict them.' },
  codex: { group: 'The table', term: 'Codex', text: 'The table\'s shared notes: the Canon, and the log of who earned Conviction.' },
  ledger: { group: 'The table', term: 'Ledger', text: 'Rolls in progress and past rolls.' },
  roster: { group: 'The table', term: 'Roster', text: 'Everyone\'s character sheet, and your own settings.' },
  veteran: { group: 'Making a character', term: 'Veteran', text: 'A character who has lived longer: four Life Chapters instead of three.' },
  swap: { group: 'Making a character', term: 'Swap', text: 'Once during creation you may undo one Skill or Trait the others granted, so they can grant a different one.' },
  object: { group: 'Making a character', term: 'Object', text: 'Say you disagree with a pick someone made for their own chapter. The pick is undone and the other players propose instead.' },
  thread: { group: 'Making a character', term: 'Thread', text: 'Unfinished business from your past: an enemy, a debt, a promise or a secret. The GM can bring it back into play.' },
  connection: { group: 'Making a character', term: 'Connection', text: 'A person or community your character is tied to: family, home, a friend.' },
  resource: { group: 'Making a character', term: 'Resource', text: 'Something your character can draw on. Choosing one raises your Wealth or your Network by a rung.' },
  skill: { group: 'Rolling', term: 'Skill and rank', text: 'What your character is good at. Ranks go Untrained, Trained, Capable, Expert, Master.' },
  want: { group: 'Rolling', term: 'Want and Risk', text: 'Want is what your character wants and how they go about it. Risk is what failure feels like.' },
  difficulty: { group: 'Rolling', term: 'Difficulty', text: 'How hard the goal is.' },
  danger: { group: 'Rolling', term: 'Danger', text: 'What could go wrong even if you succeed: a cost. Its rank runs from Minor up to Grave.' },
  odds: { group: 'Rolling', term: 'Odds', text: 'How likely you are to reach the goal, and how likely the Danger is to land, said in words such as Even or Unlikely.' },
  quick: { group: 'Rolling', term: 'Quick roll', text: 'You propose the ranks and roll it yourself.' },
  big: { group: 'Rolling', term: 'Big roll', text: 'A Belief is on the line, or the GM marks it important. The GM sets the ranks, so wait for them.' },
  drafting: { group: 'Rolling', term: 'Drafting', text: 'The card is still being written. Fill in Want, Risk and both ranks. A quick roll can then be rolled; a big roll waits for the GM.' },
  set: { group: 'Rolling', term: 'Set', text: 'The moment the Difficulty and Danger are fixed. After Set you can roll, push or concede; there is no more bargaining.' },
  shift: { group: 'Rolling', term: 'Shift', text: 'A reason to move the Skill, the Difficulty or the Danger up or down one rank: a Trait, armor, a helper, preparation.' },
  onTheLine: { group: 'Rolling', term: 'On the line', text: 'The Belief this roll tests. If one is on the line, the Danger becomes a Burden.' },
  backing: { group: 'Rolling', term: 'Backed by a Belief', text: 'A Belief that helps this roll. You roll a second time at that Belief\'s rank and the better roll counts.' },
  push: { group: 'Rolling', term: 'Push', text: 'After failing the goal, try once more against the same Difficulty. If the Danger missed, it is checked again one rank worse. Spending Conviction skips that second check.' },
  concede: { group: 'Rolling', term: 'Concede', text: 'Give up the goal and write your own defeat (surrender, escape, capture and so on) instead of rolling or pushing. A Danger that already landed still happens.' },
  flourish: { group: 'Rolling', term: 'Flourish', text: 'A bonus when the roll hits the best result your rank allows: add one true detail that helps your character.' },
  stitch: { group: 'Rolling', term: 'Stitch and beats', text: 'In a battle each player writes a beat of one to three sentences. The GM stitches the beats into one post.' },
  belief: { group: 'Beliefs and what they cost', term: 'Belief', text: 'What your character stands for: an objective, a relationship and a worldview. A Belief holds a conviction and something you will do about it.' },
  coreBelief: { group: 'Beliefs and what they cost', term: 'Core Belief', text: 'Your worldview Belief. It backs a roll strongly, but only when it is on the line, and then the Danger is a Burden.' },
  instinct: { group: 'Beliefs and what they cost', term: 'Instinct', text: 'An automatic habit, such as "never enter a room without checking the exits". It simply happens; there is no roll for it.' },
  trait: { group: 'Beliefs and what they cost', term: 'Trait', text: 'What your character has become (Merciful, Scarred Veteran). A relevant Trait shifts a roll by one rank. A harmful Trait earns Conviction when it causes real trouble.' },
  burden: { group: 'Beliefs and what they cost', term: 'Burden', text: 'A lasting change that comes when a Belief is put on the line and the Danger lands. You carry it until play lets you lay it down. At most two at a time.' },
  conviction: { group: 'Beliefs and what they cost', term: 'Conviction', text: 'A token earned when acting on a Belief costs something real. Spend one to push without a second Danger check, or to take an ally\'s Danger. You can hold three.' },
  wound: { group: 'Beliefs and what they cost', term: 'Wounds', text: 'Physical harm, from Hurt through Wounded and Critical to Mortal. A wound shifts your Skill down.' },
  spotlight: { group: 'The table', term: 'Spotlight', text: 'Whose turn it is to write. Pass it on, or take it when no one holds it. Anyone left out twice gets the next post.' },
  post: { group: 'The table', term: 'Post', text: 'To post a paragraph is to name it for a step: write it in the Story first, then choose it in the form.' },
} as const satisfies Record<string, GlossaryEntry>;

export type TermKey = keyof typeof GLOSSARY;
