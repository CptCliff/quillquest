

# Quillquest: Software Design Plan
 · 

## Summary
This plan describes a browser app for playing Quillquest (formerly the Narrative Step-Die RPG; Rules v4). Players co-write a story live, Google Docs style, in a two-pane window: prose on the left, the game on the right. The software runs every countable rule, hides the dice behind named ranks, walks the table through character creation, and gives the GM a private Director tab with Claude as an optional assistant. It is written to be built by Claude Code, milestone by milestone, starting with a fully tested rules engine.
Source of truth for rules: Narrative Step-Die RPG: Rules v4. The Appendix of this plan restates every rule the software must implement.

### Interview decisions
# | 
Topic | 
Decision
1 | 
How people play | 
Live when the table is together, play-by-post when it isn't
2 | 
GM | 
A human GM, with Claude as an optional assistant; Claude never acts on its own
3 | 
Platform | 
Browser web app; stacked, tabbed layout on phones
4 | 
Accounts | 
Email or Google sign-in, automatic saving, email notifications
5 | 
Panes and editing | 
Live co-writing in per-writer colors; own text editable, others' text gets suggestions; prose above a resolved roll locks; inline Skill chips (code first, Claude for paraphrases); GM-only Director tab
6 | 
Info buttons | 
Tappable names, Skill chips, and Canon terms open cards; open table, so everyone sees every player character's full sheet
7 | 
Character creation | 
Session zero written in the panes with a creation tracker and grant cards, plus solo draft mode
8 | 
Rules engine | 
Enforce the counting, suggest the judgment calls, GM can override anything (logged)
9 | 
GM secrets | 
Private prep, public truth: GM notes and NPC sheets hidden until revealed
10 | 
Build order | 
Rules engine first, in TypeScript, fully unit-tested

## 1. Product Overview and Play Modes

### 1.1 Who uses it
Role | 
Can do
Player | 
Write prose, fill prompt cards, propose ranks on quick rolls, accept suggestion chips, push, spend Conviction, nominate others for Conviction, reveal dice, view every player character's sheet
GM | 
Everything a player can, plus: set and adjust ranks, retcon quick rolls, award Conviction, override any enforced rule (logged), keep hidden notes and NPCs, use the Director tab and the Claude assistant
A campaign has exactly one GM. A person can be a player in one campaign and the GM of another.

### 1.2 Two play modes, one app
The same campaign switches between modes automatically, depending on who is online.
Live: players who are online see each other's cursors, typing, prompt cards, and rolls in real time. Battle declarations, Set, and resolution happen in one sitting.
Async (play-by-post): when the spotlight passes to someone who is offline, or a roll waits on someone's input, that person gets an email with a link straight to the waiting card or post. Their work appears for everyone when they come back.
Nothing in the rules changes between modes. The difference is only how fast the next step arrives.

### 1.3 What the software does and doesn't do
Does: keep every record, roll every die, compute every rank and shift, enforce every countable limit, show odds in words, lock settled prose, notify people, and suggest judgment calls as chips.
Doesn't: write the story, decide whether a Belief applies, decide whether a scene earns Conviction, or speak to players as Claude. Those stay with the people at the table. (Rule of thumb 16: automate the remembering, never the narrating.)

## 2. Architecture and Stack
The browser shows instant previews using the same rules engine, but every roll is resolved on the server, so no one can tamper with dice from their own machine.

### 2.1 Stack
Part | 
Choice | 
Why
Language | 
TypeScript everywhere | 
One language across rules, server, and UI; strong types for game state
Web app | 
Next.js (React) | 
Pages and server routes in one project
Live co-writing | 
TipTap (ProseMirror) + Yjs, synced through Hocuspocus | 
Proven Google Docs-style editing: per-user cursors and colors, offline merge, suggestion marks
Database and sign-in | 
Postgres with email and Google sign-in (Supabase provides both) | 
Managed, with row-level security for hidden GM data
Rules engine | 
packages/rules: pure functions, no I/O | 
Testable in isolation; shared by browser and server
Claude | 
Anthropic API, called only from the Game API | 
Keeps the API key private; every call is logged
Email | 
A transactional email service | 
Async notifications
Tests | 
Vitest for units, Playwright for end-to-end | 
Fast rule tests; scripted multi-user play tests

### 2.2 Repository layout

### 2.3 Hosting
The web app and Game API run on a Next.js host; the sync server needs a host that keeps long-lived WebSocket connections open; the database runs on Supabase. All three can start on free or low-cost tiers for a small playtest group.

## 3. Data Model
Two kinds of storage: shared documents (the prose, held by Yjs and snapshotted to Postgres) and game records (everything the rules engine reads or writes, in Postgres tables). The game records are the truth; the prose refers to them by id.

### 3.1 Game records
Record | 
Key fields | 
Notes
User | 
id, name, email, color | 
The color is the writer's ink in the panes
Campaign | 
id, title, gmUserId, status (sessionZero, playing), worldFact, themesToHandleLightly | 
One GM per campaign
Membership | 
campaignId, userId, role (player, gm) | 

Character | 
id, campaignId, ownerId, name, origin, chapters[3–4], conviction (0–3), armor (none, light, heavy), armorBroken | 
Visible to every member (open table)
Skill | 
characterId, name, rank (Untrained…Master), source (origin, chapter n, play) | 
Rated ranks only; shifted ranks are never stored
Belief | 
characterId, kind (objective, relationship, worldview), text, isCore, convictionEarnedThisSession | 
Core = the worldview Belief
Instinct | 
characterId, text | 
Three
Trait | 
characterId, text, harmful, source (chapter, burden, scar, arc review, possession) | 
Three to five, plus possession Traits
Burden | 
characterId, beliefId, name, about, status (active, laidDown), outcome (trait, beliefRewrite) | 
At most two active
Wound | 
characterId, level (Hurt, Wounded, Critical, Mortal), name, isExhaustion, isScar | 
Slots: 2 / 2 / 1; Collapsed is a flag
Possession | 
characterId, name, story, traitText | 
At most three
Connection, Thread, Standing | 
characterId, text (Standing: community + word) | 

Resource | 
characterId, wealthRung, networkRung | 
Rungs map to Untrained…Master
Tradition | 
characterId, source, method, price, priceSeverities[3], practicedEffects[≤3] | 
One per character
NPC | 
campaignId, name, skills, beliefs, notes, revealedFields[] | 
Hidden fields readable by the GM only
CanonEntry | 
campaignId, kind (worldFact, settled), text, sourcePostRange | 
Public
PromptCard | 
id, campaignId, actorId, speed (quick, big, battle), want, risk, onTheLine (beliefId or none), skillId, difficultyRank, dangerRank, dangerText, shifts[], backingBeliefId, status (draft, set, rolled, written) | 
One per roll
Roll | 
cardId, dice (hidden), goalResult, dangerResult, flourish, roomToSpare, pushed (none, standard, conviction), revealedBy[] | 
Dice are stored but shown only on reveal
BattleRoll | 
cardId (the lead's), contributions[] (characterId, type Press/Open/Cover, target, dangerText, dangerRank, withdrawn) | 

ConvictionEvent | 
characterId, beliefId, reason, nominatedBy, awardedBy, delta | 
The Codex's Conviction log
Override | 
campaignId, gmId, rule, before, after, reason | 
Every GM override, shown in the Ledger
Suggestion | 
campaignId, kind (skillMatch, beliefChallenge, danger, npcLine, oracle, grant), input, output, status (shown, used, edited, dismissed) | 
Every Claude output, logged

### 3.2 Shared documents
Story document (one per campaign): the prose. Each paragraph carries its author, its point of view (own, borrowed: whose, or GM), and a lock flag. Skill chips and character names are inline marks that point at record ids.
Notes scratch document (one per campaign): free co-writing space in the Ledger, for thinking through the next challenge while someone else writes prose.
GM notes document (one per campaign): visible only to the GM.

### 3.3 Locking
When a roll's outcome is written into the Story pane, every paragraph from the start of the story through the outcome paragraph is marked locked. The sync server rejects edits inside locked ranges, except a GM retcon, which unlocks a quick roll's range until the next post builds on it again.

## 4. Rules Engine Specification (Milestone 1)
packages/rules is the game. It holds no UI, no network, and no database: pure functions that take game state and return results. Randomness comes in through an injected dice source, so every test is repeatable.

### 4.1 Constants

### 4.2 Functions
Function | 
Does | 
Enforces
applyShifts(card) | 
Turns a card's rated Skill, Difficulty, Danger, and list of shifts into final ladder positions | 
Stacking; one preparation shift per ladder; battle cap of two per ladder; the edge rule (Danger past Minor or Grave moves the Skill the other way; past Hampered, Trivial, Peerless, or Mythic is lost)
setCard(card) | 
Closes Set | 
Fixes the worst cost from the final Danger rank; rejects a Grave Mortal Danger unless declared Mortal
odds(card) | 
Exact chances for goal and Danger, counting backing | 
Returns the five-band words (Sure bet…Desperate; Remote…Near certain)
resolve(card, dice) | 
Rolls Skill, backing (keep the better), Difficulty, Danger | 
Difficulty ties to the opposition; Danger ties to the player; Flourish (kept die shows its top face); Room to spare (beats Difficulty by 4+)
push(roll, kind, dice) | 
One retry after a failed goal | 
A hit Danger stands; standard push rechecks an avoided Danger one rank worse, never past Grave, never raising severity; Conviction push skips the recheck and spends a token; only once per card
resolveBattle(lead, contributions, dice) | 
One roll against the Difficulty and each Danger | 
Per-character Dangers; withdrawal before a push; whole-table recheck on a standard push
applyWound(character, level) | 
Fills slots and escalates to the next open rung | 
Armor already applied at Set; exhaustion stops at Collapsed; Mortal only from a declared Grave or a full Critical
heal(character, wound, kind) | 
Steps a wound down the healing ladder | 
Safe rest, treatment, stabilization rules
awardConviction(character, beliefId, reason) | 
Adds a token | 
Cap of 3; one per Belief per session, except laying down a Burden
spendConviction(character, use) | 
Conviction push or taking an ally's Danger | 
Must hold a token
addBurden(character, beliefId) / layDownBurden(...) | 
Burden lifecycle | 
Two active; a third forces a lay-down or rewrite; laying down always earns a token
validateCreation(character) | 
Session zero checks | 
Bad chapter is second or third; at least one each of Connection, Resource, Thread; Skills cap at Expert; one swap; end-of-creation check
opposedDifficulty(skillRank) | 
Opponent's Skill to a Difficulty on the same row | 

armorShift(armor, dangerRank, threatKind) | 
Light stops Real and Serious; Heavy stops any blade, blow, or arrow | 
No effect on fire, falls, drowning, poison, magic
magicShifts(effect) | 
Practiced shifts Difficulty down; improvised shifts both up | 
Up to three practiced effects

### 4.3 What the engine suggests but never decides
These return candidates with a reason, for a person to accept: which Traits, wounds, possessions, or Standing apply; whether a Belief backs the roll; whether a Belief is on the line; whether a scene qualifies for Conviction. The UI shows them as chips (Section 5).

### 4.4 Required tests (acceptance for milestone 1)
Odds tables: odds() for every Skill and Difficulty pair matches Appendix A of Rules v4 exactly (for example Capable vs Demanding = 44% goal; Capable vs Serious = 56% avoid).
Ties: a tie against Difficulty fails; a tie against Danger avoids.
Backing: Trained backing on a Capable Skill raises the goal chance by roughly 10–15 points across the table.
Edge rule: armor against a Minor threat shifts the Skill up; a strained wound against a Grave Danger shifts the Skill down.
Severity: a standard push from Severe rechecks at Grave odds but the worst cost stays Critical.
Push: a hit Danger survives a push; a Conviction push never rechecks; a second push is rejected.
Wounds: a Hurt with full Hurt and Wounded rows becomes Critical; exhaustion never passes Collapsed.
Conviction: a fourth token is rejected; a second award to the same Belief in one session is rejected, except laying down a Burden.
Burdens: a third Burden is rejected until one is laid down or its Belief rewritten.
Creation: a character with the bad chapter last, or no Thread, fails validation.
Property tests: across 100,000 seeded rolls, measured results land within 1 point of the computed odds.

## 5. The Workspace
Each writer's words appear in their own color. Here Ilse's player writes prose while Sella's player drafts the next challenge in the Notes pane, and a tap on Ilse's Skill chip opens her card.

### 5.1 Story pane (left)
One continuous shared document for the whole campaign, written live by everyone. Each paragraph shows its author's color and a small point-of-view label (own, borrowed: whose, or GM).
Editing (Question 5, option A): you edit your own text freely. Changes to someone else's text become suggestions (struck through and inserted, in your color) that the author accepts or rejects.
Locks: prose above a resolved roll shows a faint band and can't be edited, except by a GM retcon of a quick roll.
Spotlight: the composer bar at the bottom names whose turn it is. Anyone may still type anywhere; the spotlight decides whose post the software treats as the next beat and who gets notified (Section 10).
Borrowed point of view: a writer can tag a paragraph as borrowing another character. The owner can veto any inner thought, feeling, or choice with one tap; the writer revises that sentence. A borrowed paragraph can't start a roll for the borrowed character.

### 5.2 Notes pane (right)
Tab | 
Who sees it | 
Holds
Ledger | 
Everyone | 
The active prompt card(s); collapsed past rolls with their outcome prompts; overrides; a shared scratch area for drafting ahead while others write prose
Codex | 
Everyone | 
The Canon (world facts and settled questions) and the Conviction log
Roster | 
Everyone | 
Full character sheets (open table); revealed parts of NPC sheets
Director | 
GM only | 
Section 8
A draggable divider sets the width of each pane; each person's setting is remembered. (Built in the design pass as a dockable workspace: every panel can be dragged to any edge, stacked as tabs, resized, hidden and restored, and the arrangement is saved per person; see docs/m8-notes.md.)

### 5.3 Inline Skill chips
As a writer types, the software looks for a Skill being used and offers an inline chip such as Sneak · Expert.
Code first. A matcher checks the writer's character sheet for Skill names and common forms (sneak, sneaking, snuck) in the current sentence. A match shows a solid chip at once, with the rank taken from the sheet, never guessed.
Claude for paraphrases. When the writer pauses on a sentence with an action verb and no match ("I creep past the guards"), the Game API asks Claude which of this character's Skills fits. Claude may only answer with a Skill already on the sheet, or "none." The result shows as a dashed chip until the writer taps it.
A chip can start a roll. Tapping an accepted chip opens a prompt card in the Ledger with that Skill filled in. Ignoring a chip does nothing.
Ranks shown are always current: the chip shows the rated rank; the card shows shifts once Set begins.

### 5.4 Info cards
Tap on | 
Card shows
A character's name | 
Skills with ranks, Beliefs (Core marked), Traits, wounds, Burdens, Conviction, possessions, Connections; an Open full sheet link
A Skill chip | 
The rated rank and any shifts applying right now, each with its reason ("Expert, shifted down by Hurt: twisted ankle")
A Canon term (place, faction, named NPC) | 
The Canon entry; for an NPC, only its revealed parts
A resolved roll in the Ledger | 
The prompt card, the outcome prompt, and a Reveal dice button
Cards open beside the text on a computer and as a bottom sheet on a phone.

### 5.5 Phone layout
The panes become two tabs, Story and Notes, with a badge on Notes when a card needs you. Chips and info cards work the same way.

## 6. Roll Flows
Every roll is a prompt card that moves through the same states. Only who fills each field, and when the prose stops, differs by speed.
State | 
What happens | 
Who acts
Draft | 
Want, Risk, and On the line are filled; ranks proposed (quick) or left for the GM (big, battle) | 
Acting player
Set | 
Danger sharpened; Difficulty and Danger ranks named; shifts accepted from chips; odds words shown; severity fixed when Set closes | 
GM (big, battle) or nobody needed (quick: proposed ranks stand unless the GM changes them)
Rolled | 
The server resolves; the outcome prompt appears; push and concede buttons show if they apply | 
Server, then acting player
Written | 
The outcome is written into the Story pane; prose above it locks; the card collapses in the Ledger | 
Writers
At any point before Rolled, a player may concede from the card, and the GM may override any field (logged).

### 6.1 Quick roll (in one post)
The writer types prose, taps a Skill chip (or opens a blank card), and fills Want and Risk in one line each.
The writer proposes the ranks from drop-downs that use the rank words ("Ordinary wall; Real Danger: I twist an ankle"). Suggestion chips offer relevant shifts (a Trait, a wound, gear); the writer taps the ones that apply.
The card shows the odds words. The GM sees the card in the Director tab and may change the ranks; if the GM doesn't act, the ranks stand.
The writer taps Roll. The outcome prompt appears, and the writer writes the attempt and its outcome in the same post.
GM retcon: until the next post builds on it, the GM can reopen the card, change the ranks, and reroll. The writer's outcome paragraph is unlocked for revision.

### 6.2 Big roll (stop at the moment of action)
A card becomes a big roll automatically when On the line names a Belief, when the Danger affects another character, or when the GM marks it.
The writer posts up to the moment of action and stops; the card opens.
If On the line names a Belief, the card marks the Danger as a Burden and offers Core backing when it's the Core Belief. Other players can challenge the claim with a comment on the card.
The GM sets the card (with Claude's Danger-sharpening help if wanted). If Set isn't agreed after two exchanges of comments, the GM's call stands.
Roll. The outcome prompt goes to the acting player; if the cost lands on someone else, that player is notified and writes their own cost.
Push: if the goal failed, the card offers Try again (standard) and Try again with Conviction (spends a token). After a standard push the software shows which avoided Dangers are being checked again, one rank worse.
Success voice: the outcome prompt adds Flourish, Belief success, or Room to spare when they apply.

### 6.3 Battle roll
The GM opens a battle card: the goal, the battle's Danger, the opposition's Difficulty, and a framing post.
The lead fills the main card. Every other player gets a contribution card at the same time: a line of action, a type (Press, Open, Cover), a target, and their own Danger. Async players get an email; the card shows who is still declaring.
The engine applies contributions, capped at two ranks per ladder, and shows the odds words for the battle and for each Danger.
The GM sets all Dangers at once and taps Roll: one roll against the Difficulty and against each Danger.
Before a standard push, each contributor gets a one-tap Withdraw for a short window (live) or until they respond (async).
Each player writes a one- to three-sentence beat in their contribution card. The software stitches the beats into one Story post in the GM's order: the lead first, then contributions, then costs. Each beat keeps its writer's color.

### 6.4 Opposed and social rolls
When a card targets an NPC or another player character, the Difficulty is filled from that character's relevant Skill on the same row. For another player character, that player is asked to agree on the Danger before Set closes.

## 7. Character Creation Walkthrough
Creation is written as the campaign's prologue in the Story pane. The Notes pane walks each player through it with a creation tracker, and the rules engine checks every step.

### 7.1 Solo draft mode (before session zero)
From the campaign page, a player opens Draft my character: a private two-pane page with only their own Story draft and their own tracker.
They may draft the Origin and the three Life Chapters (prose, one-line summaries, and which chapter ends badly). Grants, crossings, and Beliefs wait for the table.
At session zero the player taps Bring my draft; the paragraphs are inserted into the shared prologue in their color, and the grant cards open for the other players.

### 7.2 Session zero, step by step
Step | 
In the Story pane | 
In the Notes pane (tracker) | 
Checks
0. World fact | 
GM writes the setting's central pressure | 
Added to the Canon | 
Exactly one table-wide fact
1. Origin | 
A short paragraph | 
Player picks one Skill at Trained and names one Connection | 

2. Life Chapters (3, or 4 for veterans) | 
One paragraph each; tracker prompt: where I was, what I did, how it ended | 
After each chapter, a grant card goes to the other players; the writer picks Connection, Resource, or Thread | 
Bad chapter is the second or third; the other players propose how it ends badly and the writer picks one
3. World facts | 
One per chapter, written as a sentence that leaves a question open | 
Each added to the Canon; a fact naming a community prompts a Standing word | 

4. Crossing paths | 
Two short scenes per character, each naming a chapter from both characters; the other player may borrow the viewpoint to answer | 
Each crossing adds a Connection to both and at most one Thread between them | 
Everyone has two crossings; one touches a Belief
5. Capital | 
— | 
Wealth and Network rungs, Standing words, up to three possessions with one line of story each | 
Resource outputs raise rungs
6. Beliefs | 
— | 
Three Beliefs (objective, relationship, worldview); worldview marked Core | 
Each must hold a conviction and something to do about it (Claude can flag one that doesn't)
7. Instincts | 
— | 
Three | 

8. Starting hook | 
The past Thread that catches up today | 
Picked from the character's Threads | 

### 7.3 Grant cards
After a chapter is posted, each other player gets a card with the chapter's summary and two pickers: Skill (new at Trained, or raise an existing one a rank) and Trait (harmful for the bad chapter).
Claude suggestions: the card can show three Skill and three Trait suggestions drawn from the chapter's prose. Players can pick one, edit it, or write their own.
Agreement: the first grant that a majority of the other players accept is applied; with two players, the other player decides. The GM breaks ties.
One swap: the writing player has a single Swap button for all of creation, which reopens one grant.
If the bad chapter tested a Belief, the card offers to start the character with one Burden.

### 7.4 End-of-creation check
The tracker shows a checklist; Begin play unlocks only when every character has:
a Skill at Capable or better;
Connections to two other characters;
a Thread the GM can use;
starting Skills no higher than Expert;
at least one each of Connection, Resource, and Thread from chapters.
The GM can override a failed check (logged), for example for a deliberately odd character.

## 8. GM Tools and the Claude Assistant

### 8.1 The Director tab (GM only)
Panel | 
Shows | 
Actions
Beliefs board | 
Every character's three Beliefs (Core marked), active Burdens, Conviction count, and which Beliefs have earned a token this session | 
Ask for challenge prompts for any Belief
Pending cards | 
Every prompt card waiting on Set, with one-tap rank adjustments and the odds words updating live | 
Set, adjust, override, retcon a quick roll
Conviction | 
One award button per character; players' nominations beside it, with the reason | 
Award or decline
NPC roster | 
NPC sheets (Skills, Beliefs, notes), each field marked hidden or revealed | 
Reveal a field; opposed rolls pull the NPC's rank automatically
GM notes | 
A private co-writing document | 
—
Claude assistant | 
Draft suggestions, never posted automatically | 
Use, edit, or dismiss
Override log | 
Every GM override with its reason | 
—
The Director tab and its data are protected on the server (row-level security), not just hidden in the browser.

### 8.2 What the Claude assistant can do
Request | 
Input sent to Claude | 
Output | 
Where it goes
Challenge prompts | 
Recent Story pane text (about the last 3,000 words), the chosen character's Beliefs and Burdens, the Canon | 
Up to three ways the current scene could test that Belief, each one or two sentences | 
Director, as drafts
Sharpen a Danger | 
The prompt card (Want, Risk, On the line) and the scene | 
Two or three sharper Dangers that pass the Danger test (could this happen even if you succeed?), each with a suggested Danger rank | 
The card, as chips
NPC line | 
The NPC's sheet and the scene | 
A short line of dialogue in that NPC's voice | 
Director, as a draft the GM pastes or edits
Burden oracle | 
The campaign's six table-written faces and the scene | 
One face chosen, with a sentence tying it to the scene | 
The acting player's card, as a prompt
Skill match (players too) | 
The sentence and the character's Skill list | 
One Skill from the list, or "none" | 
An inline chip
Grant suggestions (players too) | 
One Life Chapter's prose | 
Three Skills and three Traits | 
The grant card
Belief check (players too) | 
A drafted Belief | 
Whether it holds a conviction and an action, with a one-line fix if not | 
The creation tracker

### 8.3 Guardrails
Draft only: nothing Claude writes reaches the Story pane, the Canon, or a record unless a person accepts it.
Bounded answers: Skill matching and grant suggestions are constrained to valid choices; the server rejects anything else.
No secrets to players: requests from players never include GM notes, hidden NPC fields, or the Director data.
Themes respected: every prompt includes the campaign's "handle lightly or leave out" themes.
Logged and capped: every call is recorded as a Suggestion; the GM sets a per-session limit to control cost.
Prompts are code: templates live in packages/prompts with fixed test cases, so changes are reviewed like any other code.

## 9. Accounts, Campaigns, Permissions, Visibility

### 9.1 Accounts and campaigns
Sign in with email (magic link) or Google. Each account picks a display name and an ink color; the app adjusts colors so no two writers in a campaign share one.
The GM creates a campaign and invites players by email or link. A player joins with their account and may belong to many campaigns.
Everything saves continuously; there is no Save button.
Leaving: a player who leaves keeps a read-only copy of the story; their character stays in the campaign as an NPC the GM can retire.

### 9.2 Who can see and do what
Data | 
Players | 
GM
Story pane, Ledger, Codex | 
Read and write | 
Read and write
Player character sheets | 
Read all; edit only their own (through the engine) | 
Read all; override any field (logged)
Dice of a roll | 
Hidden until someone taps Reveal | 
Always visible
NPC sheets | 
Revealed fields only | 
All
GM notes, Director tab | 
No access | 
Full
Claude assistant | 
Skill match, grant suggestions, Belief check | 
All requests
Others' prose | 
Suggestions only | 
Suggestions, plus retcon of a quick roll

### 9.3 Enforcement
Permissions are checked on the server: row-level security in Postgres for records, and per-user checks in the sync server for document edits (locks, suggestions, the GM notes document). The browser only reflects what the server allows.

## 10. Async Play and Notifications
The app always knows who the story is waiting on. When that person is offline, it tells them.
Waiting on | 
Trigger | 
Message links to
The spotlight | 
A post ends by passing the spotlight to you | 
Your place in the Story pane
The GM's Set | 
A big or battle card is ready for Set | 
The card in the Director tab
A battle contribution | 
A battle card opens | 
Your contribution card
Your own cost | 
A Danger lands on your character from someone else's roll | 
The outcome prompt
A grant | 
A chapter is posted in session zero | 
The grant card
A veto | 
Someone borrows your character | 
The borrowed paragraph
Conviction | 
You were nominated or awarded | 
The Conviction log
Batching: messages wait two minutes and combine, so a busy scene sends one email, not ten.
Presence: nobody is emailed while they have the campaign open.
Preferences: each player chooses immediate, a daily digest, or off, per campaign.
Left out: the spotlight rule (anyone left out for two rounds gets the next post) is tracked by the server, and that player is notified when it applies.
Stalls: if a card waits more than a set time (the GM chooses, for example 48 hours), the GM is reminded and may set it, skip the contributor, or pass the spotlight.

## 11. Milestones and the Claude Code Workflow
Each milestone ends with something you can test by hand; nothing later rewrites the rules engine.

### 11.1 Acceptance per milestone
Milestone | 
Done when
M1 Rules engine | 
Every test in Section 4.4 passes; the odds tables generated by the engine match Rules v4 Appendix A
M2 Live editor | 
Two browsers co-write one page with distinct colors and live cursors; a suggestion on another's text can be accepted or rejected; a locked range refuses edits
M3 Rolls | 
A quick roll and a big roll run end to end; the outcome prompt matches the engine; a push rechecks correctly; prose above a written outcome locks; dice reveal works
M4 Accounts and Roster | 
Three test accounts join a campaign; each sees all sheets; info cards open from names and chips; typing a Skill name shows a chip with the right rank
M5 Session zero | 
A test table completes creation for three characters, including grants, one swap, crossings, and the end check; a solo draft imports cleanly
M6 Director and Claude | 
The GM sees the Beliefs board, sets pending cards, awards Conviction, reveals NPC fields; a player account can't read any GM data (tested on the server); each Claude request returns a draft and is logged
M7 Battle, async, phone | 
A four-player battle roll resolves with withdrawals and stitched beats; an offline player receives a batched email and lands on the right card; the phone layout passes a play-through

### 11.2 How Claude Code builds it
Put the rules where Claude Code can read them. Copy Rules v4 and this plan into /docs in the repository.
Write CLAUDE.md with standing instructions:
Read /docs/rules-v4.md and /docs/design-plan.md before any change.
The rules engine is the source of truth; UI and server code never re-implement a rule.
Write or update tests before code; run the full test suite before finishing.
Use rank words in anything a player sees; dice appear only in the reveal view and in tests.
Never send GM-only data to a player route; add a server test for every new route.
Claude prompts live in packages/prompts with fixed test cases.
One milestone per session. Start each with plan mode: ask Claude Code to read the docs and propose a task list for the milestone, review it, then let it build.
Test-first for M1. Begin with a prompt such as: "Read /docs. Implement packages/rules as specified in Section 4 of the design plan. Write the tests in 4.4 first, then the functions, until all tests pass."
Check in at each milestone. Run the acceptance list in 11.1 by hand, commit, and note any rule questions back into the rules document rather than patching around them in code.
Play early. After M3, run a short solo scene with two browser windows; after M5, run session zero with real players.

## 12. Risks and Open Questions

### 12.1 Risks
Risk | 
Why it matters | 
Mitigation
Live co-writing is the hardest part to get right | 
Locks and suggestions on top of Yjs need careful server checks | 
Build it in M2 before anything depends on it; use TipTap's existing collaboration and suggestion extensions where they fit
Everyone typing at once can blur whose beat it is | 
Prose may tangle when two people write the same moment | 
The spotlight bar, paragraph authorship, and suggestion mode; watch for it in the first playtest
Skill chips misfire | 
A wrong chip at the wrong moment feels like the app is grading the prose | 
Code matcher first, Claude only as a dashed suggestion; chips never start a roll by themselves
Claude cost and latency | 
Paraphrase matching runs often | 
Only call Claude on a pause with no code match; cache per sentence; GM's per-session cap
Hidden GM data leaking | 
An open-table app with one private tab | 
Server-side row-level security and route tests in M6
Scope | 
Seven milestones is a real project | 
Each milestone is usable on its own; M3 is already a playable two-browser game

### 12.2 Open questions for later
Turn order in live play: does spotlight passing feel right when everyone can type at once, or should the composer bar show a queue?
Battle beats: should the GM be able to edit the order of stitched beats after they're written?
Export: a printable or e-book export of a finished campaign (the story plus the Canon) would fit the game's writing focus; not yet scheduled.
Rules held back (Rules v4, Section 13): the bell-curve Skill, remembering Danger, and growing Belief backing could ship later as GM toggles; the engine's dice-source design leaves room for them.

## Appendix: Complete Rules Reference (Rules v4)
A condensed statement of every rule the software implements. Where this and Rules v4 disagree, Rules v4 governs and this appendix gets fixed.

### A.1 Play format
Two panes: Story (prose, written live by everyone in their own color) and Notes (Ledger, Codex, Roster; plus the GM-only Director).
Points of view: your own character, a borrowed character, or the GM's. Borrowing needs no permission; the owner may veto inner thoughts, feelings, or choices; a borrowed post can't start a roll for the borrowed character or make them break a Belief or Instinct.
Turn order: spotlight passing. Every post passes to the character most affected, or the writer's choice; the GM may take any post; anyone left out for two rounds gets the next post.
Editing: your own text freely; others' text by suggestion; prose above a resolved roll locks except for a GM retcon of a quick roll, which must happen before the next post builds on it.

### A.2 The roll
Roll only with a goal and a Danger. Don't roll if success is certain.
Prompt card: Want, Risk, On the line (a Belief or none), Set (Difficulty and Danger ranks), Gather, Roll. The Danger test: could this happen even if you succeed?
Quick rolls run in one post: the player proposes ranks; the GM may change them; if not, they stand. Big rolls (a Belief on the line, another character affected, or a battle) stop at the moment of action, and the GM sets them.
Negotiate before the roll, never after. If Set isn't agreed in two exchanges, the GM's call stands.
Ranks: Skill Hampered, Untrained, Trained, Capable, Expert, Master, Heroic, Peerless. Difficulty Trivial, Simple, Ordinary, Demanding, Hard, Extraordinary, Legendary, Mythic. Danger Minor, Real, Serious, Severe, Grave. Skills are rated Untrained to Master; shifts reach Hampered, Heroic, or Peerless for one roll. Difficulty runs Simple to Mythic, shifts reach Trivial. Danger stays Minor to Grave.
Ties: against Difficulty, the opposition wins; against Danger, the player does.
Belief backing: a relevant Belief adds a second roll at Trained; the Core Belief adds Capable, only when on the line, and then the Danger is a Burden. Keep the better roll; one Belief per roll; wounds never affect backing; invoking is free and earns nothing.
Severity is fixed when Set closes. Later changes alter odds only.
Outcomes: success or failure on the goal; the cost lands or not. Failing the goal is not a second punishment. The acting player writes the outcome, success first; the GM may sharpen a landing cost; a cost landing on another character is written by that character's player.
Success voice: Flourish (the best result the rank allows: add one true, helpful detail; it can enter the Canon); Belief success (the Belief visibly advances in the scene); Room to spare (a wide margin: improve how, never a second goal or a cancelled Danger).
Push: once, after failing the goal. A hit Danger stands. Standard push: an avoided Danger is checked again one rank worse, never past Grave. Conviction push: no recheck.
Let It Ride: no retry until something real changes. Settled questions enter the Canon.
Shifts: the only modifiers; they stack. Traits, wounds, helping (one helper, who shares the Danger), preparation (one shift per ladder), gear, possessions, armor, Standing. Edge rule (Danger only): a shift that can't move Danger past Minor or Grave moves the Skill the other way; shifts past the ends of the other ladders are lost.
Opposed: the opponent's Skill sets the Difficulty on the same row; the acting side rolls; for two player characters, agree the Danger first. Social conflict uses the same engine; no social hit points.
Odds words: goal Sure bet, Favored, Even, Long shot, Desperate; Danger Remote, Unlikely, Even, Likely, Near certain, in 20-point bands.

### A.3 Battle roll
One roll. The GM frames the goal, the cost, and the Difficulty. The lead fills the card; every other player contributes one shift (Press: lead's Skill up; Open: Difficulty down; Cover: someone's Danger down) and takes their own Danger. At most two ranks per ladder. One roll against the Difficulty and against each Danger. A standard push rechecks every avoided Danger; contributors may withdraw before it. Beats are stitched into one post. The battle is settled afterward; concession at Set withdraws a contributor; death only from a declared Mortal Danger or escalation.

### A.4 Beliefs, Instincts, Traits, Burdens, Conviction
Three Beliefs (objective, relationship, worldview = Core). Objective and relationship Beliefs may be rewritten between sessions; the Core only through play.
Three Instincts: happen without a roll; can't be used against the character as a surprise; earn Conviction when they cause trouble; never back or shift a roll.
Three to five Traits: shift one rank when relevant; a harmful Trait earns Conviction when it causes trouble; new Traits from laid-down Burdens, Scars, and the end-of-arc review.
Burdens: when a Belief is on the line, the Danger is a Burden: a lasting change named after the roll. At most two active. Laid down when a scene tests it at real cost, which always earns Conviction (past the one-per-Belief limit). It leaves a Trait or a rewritten Belief.
Conviction: earned when a Belief costs something real (the list in Rules v4, 5.5). Spent on a Conviction push or to take an ally's Danger. Start 1, hold 3, one per Belief per session (except laying down a Burden). GM awards; anyone nominates.

### A.5 Wounds, armor, healing, concession
Ladder: Hurt (2 slots), Wounded (2), Critical (1), Mortal. Worst wound by Danger: Minor none, Real Hurt, Serious Wounded, Severe Critical, Grave Mortal. Mortal only from a Grave Danger declared Mortal, or escalation from a full Critical.
Effects: Hurt and Wounded shift the related Skill down; a strained Wounded also shifts the Danger up; Critical may drop actions to Untrained or Hampered.
Escalation climbs to the next open rung; renamed by the player; GM warns when Critical is full. Exhaustion uses Hurt and Wounded and stops at Collapsed.
Armor shifts Danger down at Set: Light against Real or Serious threats; Heavy against any blade, blow, or arrow, with hindered actions shifted down. Never against fire, falls, drowning, poison, or magic without a story reason. Break armor to ignore one wound.
Healing: Hurt clears with rest; Wounded with treatment and a safe night; Critical with substantial care, renamed down the ladder; Mortal must be stabilized (always a roll). Treatment rolls only under pressure. Optional Scars.
Concession: at Set or instead of pushing; a landed Danger still happens; the conceding player writes the defeat, no worse than the declared Danger; conceding against a Belief earns Conviction; NPCs may concede.

### A.6 Character creation
GM world fact; Origin (Skill at Trained, a Connection); three Life Chapters (four for veterans), each granting a Skill and a Trait chosen by the other players, plus the writer's pick of Connection, Resource, or Thread; one bad chapter (second or third; required Thread; harmful Trait; may start a Burden); one world fact per chapter and per crossing; two crossings per character; Capital; three Beliefs; three Instincts; starting hook. One swap. Starting Skills cap at Expert. End check: a Skill at Capable or better, Connections to two characters, a usable Thread.

### A.7 Resources, magic
Wealth and Network roll as Skill ranks (Scraping by through Fortune-scale; A few contacts through Reaches the powerful), starting at the second rung. Roll only under pressure. Standing words: Distrusted, Unknown, Known, Respected. Up to three significant possessions, each a Trait on an object.
Magic: a tradition is a Life Chapter (Source, Method, Price; one per character). No Method, no casting. The Danger is the Price at three severities. Practiced effects (up to three) shift Difficulty down; improvised effects shift both Difficulty and Danger up. No magic points. Powerful magic needs a fictional prerequisite recorded as a Thread.

### A.8 Not in the first build
Skill advancement, factions, clocks, nonphysical condition ladders, magical healing, the Desperation rule, bell-curve dice, the remembering Danger, and growing Belief backing (all parked in Rules v4).