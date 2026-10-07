// A library of Life Chapter templates for session zero (design: docs/m9-notes.md). Original text; the idea (a menu of pre-built
// stretches of life that each give a Skill, a Trait and something left behind) is borrowed, the content is not.
// Pure data and a pure matcher: no AI here. The AI only adapts a template's lists, and the player still picks.

export interface ChapterTemplate {
  id: string; walk: string; name: string; prompt: string;
  /** Lower-case words that signal the template in a player's prose. */
  keywords: string[];
  skills: string[]; traits: string[]; harmfulTraits: string[];
  outputs: { connection: string[]; resource: string[]; thread: string[] };
}

type Seed = [id: string, walk: string, name: string, prompt: string, keywords: string, skills: string, traits: string, harmful: string, connection: string, resource: string, thread: string];
const split = (s: string) => s.split('|').map((x) => x.trim()).filter(Boolean);
const make = ([id, walk, name, prompt, keywords, skills, traits, harmful, connection, resource, thread]: Seed): ChapterTemplate => ({
  id, walk, name, prompt, keywords: split(keywords), skills: split(skills), traits: split(traits), harmfulTraits: split(harmful),
  outputs: { connection: split(connection), resource: split(resource), thread: split(thread) },
});

const SEEDS: Seed[] = [
  // ---- the watch: guards, soldiers, law
  ['gate-warden', 'The watch', 'The Gate Warden', 'You stood a post where people came and went, and learned to read them.',
    'gate|guard|watch|post|sentry|toll|border|checkpoint|patrol', 'Gatekeeping|Reading Strangers|Hold the Line|Search and Seize', 'Watchful|Stoic|By the Book|Hard to Fool', 'Suspicious of Everyone|Cannot Leave a Post|Bends for Bribes',
    'A traveller who kept coming back|The captain who trusted you|A smuggler who owes you a quiet favour', 'A warden\'s badge and a standing at the gate|A key to the side door', 'A face you let through that you should not have|An order you never questioned'],
  ['shield-soldier', 'The watch', 'The Shield-Bearer', 'You fought in a line, and the line held or did not.',
    'soldier|army|war|battle|regiment|shield|march|siege|conscript|front', 'Fighting in Formation|Soldier\'s Endurance|Field Medicine|Giving Orders', 'Brave|Disciplined|Quick to Obey|Steady Under Fire', 'Haunted by the Line|Flinches at Drums|Cannot Take Orders Now',
    'A comrade who carried you out|The sergeant who made you|An enemy you spared', 'An old blade and a soldier\'s pension|A veteran\'s name in three towns', 'The battle you were not meant to survive|A promise made on the march'],
  ['constable', 'The watch', 'The Constable', 'You kept the peace in streets that did not want it kept.',
    'constable|law|crime|arrest|investigate|thief|court|magistrate|sheriff|detective', 'Investigation|Interrogation|Knowing the Streets|Law and Custom', 'Fair-Minded|Persistent|Well Known|Sharp Eyed', 'Trusts No Alibi|Makes Enemies Easily|Cannot Let a Case Go',
    'An informant who trusts only you|A magistrate with a long memory|A thief you could not catch', 'A constable\'s warrant|Favours owed in the market', 'The case that was never closed|A name you wrote in the wrong book'],
  ['scout', 'The watch', 'The Scout', 'You went ahead of everyone else and came back with what you saw.',
    'scout|spy|ranger|ahead|recon|lookout|pathfinder|messenger|courier|ride', 'Tracking|Moving Unseen|Reading Terrain|Reporting Truthfully', 'Alert|Patient|Light Sleeper|Lone Wolf', 'Distrusts Crowds|Cannot Sit Still|Keeps Secrets Too Well',
    'The commander who believed your report|A guide from the far side', 'Maps nobody else has|A good horse', 'Something you saw and did not report|A route you promised to forget'],

  // ---- trade and travel
  ['market-hand', 'Trade and travel', 'The Market Hand', 'You worked a stall, a counter or a cart and learned what people will pay for.',
    'market|merchant|stall|shop|trade|sell|buy|coin|haggle|customer|bargain', 'Haggling|Reading a Buyer|Keeping Accounts|Spotting Fakes', 'Charming|Thrifty|Well Connected|Quick with Sums', 'Cannot Resist a Bargain|Counts Every Coin|Trusts No Receipt',
    'A supplier who gives you first pick|A rival whose prices you set', 'A stall with a regular spot|A purse of savings', 'A debt you never settled|A deal that was too good'],
  ['caravan', 'Trade and travel', 'The Caravan Driver', 'You spent years on the road with goods, animals and strangers.',
    'caravan|road|wagon|driver|cart|journey|travel|haul|cargo|mule|convoy', 'Hauling|Animal Handling|Navigating Roads|Surviving the Road', 'Hardy|Easygoing|Knows Every Inn|Good with Beasts', 'Restless|Cannot Stay Put|Owes Money in Many Towns',
    'The caravan master who vouched for you|A innkeeper three towns over', 'A sturdy wagon share|Contacts along the trade road', 'A cargo that was never delivered|A road you swore never to take again'],
  ['sailor', 'Trade and travel', 'The Deckhand', 'You earned your keep on water, in weather and in close quarters.',
    'sailor|ship|boat|sea|river|deck|crew|harbour|harbor|dock|captain|sail|fish', 'Sailing|Knots and Rigging|Weather Sense|Swimming', 'Sure-Footed|Superstitious|Cheerful in a Storm|Strong Back', 'Fears Open Water|Cannot Sleep Ashore|Drinks to Forget',
    'A bosun who taught you everything|A shipmate lost overboard', 'A share in a small boat|A sailor\'s name in every port', 'The voyage that went wrong|A debt to the sea'],
  ['smuggler', 'Trade and travel', 'The Runner', 'You moved things that were not supposed to be moved.',
    'smuggle|smuggler|contraband|runner|illegal|bribe|hide|secret|black market|hidden', 'Smuggling|Talking Past Inspectors|Hiding Goods|Forging Papers', 'Cool Liar|Light Fingered|Knows the Back Ways|Nerves of Iron', 'Looks Over Their Shoulder|Never Sleeps Twice in One Place|Owes the Wrong People',
    'A fence who still takes your calls|An inspector who looks the other way', 'A hidden cache|Several false names', 'A package you never delivered|The person who sold you out'],

  // ---- craft and learning
  ['smith', 'Craft and learning', 'The Smith\'s Apprentice', 'You learned a hard craft from someone harder.',
    'smith|forge|apprentice|hammer|metal|anvil|craft|workshop|mason|carpenter|tool', 'Smithing|Repairing Anything|Judging Materials|Tireless Labour', 'Strong Hands|Patient|Takes Pride in Work|Practical', 'Burns Hot|Cannot Leave a Flaw|Distrusts Shortcuts',
    'A master who never praised you|A customer who became a friend', 'A set of good tools|A forge you can borrow', 'A piece you made that was used for harm|A master\'s unfinished work'],
  ['scribe', 'Craft and learning', 'The Scribe', 'You kept records, copied texts and learned what was not meant to be read.',
    'scribe|clerk|book|library|record|letter|copy|ledger|archive|document|read|write', 'Reading Old Hands|Forging a Seal|Keeping Records|Research', 'Precise|Well Read|Quiet Observer|Discreet', 'Cannot Stop Reading|Hates a Blot|Knows Too Much',
    'A librarian who shared forbidden shelves|A noble who paid you well', 'A small private library|Letters of introduction', 'A page you were not supposed to see|A record that was changed'],
  ['scholar', 'Craft and learning', 'The Student', 'You studied, argued and found out how little you knew.',
    'student|study|school|university|scholar|teacher|master|lecture|college|learn|academy', 'Lore|Persuasion|Languages|Natural Philosophy', 'Curious|Eloquent|Open-Minded|Stubborn about Facts', 'Condescending|Cannot Admit Doubt|Lost in Thought',
    'A teacher who championed you|A rival who made you better', 'A letter of standing from a school|A trunk of notes', 'The question you could not answer|A theory that cost someone dearly'],
  ['artist', 'Craft and learning', 'The Performer', 'You played to crowds, patrons and the occasional empty room.',
    'perform|actor|musician|singer|player|stage|troupe|bard|dance|song|music|play|theatre', 'Performing|Reading a Crowd|Mimicry|Improvising', 'Charismatic|Quick Witted|Fearless in Public|Remembers Every Line', 'Craves Applause|Cannot Be Plain|Hides Behind a Role',
    'A patron who believed in you|A troupe-mate who left', 'A costume trunk|A name people remember', 'A role you could not leave|A song that was not yours'],

  // ---- faith and healing
  ['hospitaller', 'Faith and healing', 'The Hospitaller', 'You tended the sick and the dying, and chose who to save when you could not save all.',
    'heal|healer|doctor|nurse|hospital|medicine|sick|plague|herb|wound|cure|care', 'Healing|Herbalism|Calming the Frightened|Triage', 'Gentle Hands|Calm in a Crisis|Compassionate|Tireless', 'Cannot Refuse a Patient|Carries the Dead|Never Rests',
    'A patient who never forgot you|A physician who taught you', 'A satchel of remedies|A bed at the hospital', 'The patient you could not save|A cure you were forbidden to use'],
  ['acolyte', 'Faith and healing', 'The Acolyte', 'You served a faith, its rites, its poor and its politics.',
    'priest|temple|faith|god|prayer|monk|church|shrine|pilgrim|rite|chapel|sermon', 'Ritual|Counsel|Scripture|Charity', 'Devout|Serene|Honest to a Fault|Welcomes Strangers', 'Doubts Quietly|Cannot Forgive|Judges Too Fast',
    'A priest who guided you|A pilgrim you walked with', 'A place at the shrine|A holy token', 'A vow you have not kept|A doubt you told no one'],
  ['midwife', 'Faith and healing', 'The Village Midwife', 'You were there at the births, the deaths and the quarrels in between.',
    'midwife|village|birth|baby|family|folk|neighbour|neighbor|wise woman|cunning', 'Birthing|Folk Remedies|Settling Quarrels|Knowing Everyone\'s Business', 'Trusted|Firm and Kind|Keeps Confidences|Unshockable', 'Cannot Stay Out of It|Remembers Every Slight|Meddles',
    'A family you brought children into|The elder who relied on you', 'A name every household knows|A herb garden', 'A secret you swore to keep|A child whose parentage you know'],

  // ---- the wilds
  ['hunter', 'The wilds', 'The Hunter', 'You fed yourself and others from land that gave nothing freely.',
    'hunt|hunter|forest|wood|trap|game|bow|wild|beast|track|trapper', 'Hunting|Tracking|Woodcraft|Skinning and Curing', 'Patient|Silent|Weather-Wise|Self-Reliant', 'Uneasy Indoors|Distrusts Towns|Cannot Waste Food',
    'A hunter who taught you the old ways|A farmer who trades for your game', 'A good bow and a hidden cabin|A pelt-seller\'s credit', 'A beast you could not kill|A boundary you crossed'],
  ['farmhand', 'The wilds', 'The Farmhand', 'You worked land that was not yours and learned its patience.',
    'farm|farmer|field|harvest|crop|plough|plow|barn|cattle|sheep|shepherd|village|orchard', 'Farming|Animal Husbandry|Mending Fences|Reading Weather', 'Steady|Early Riser|Modest|Strong Back', 'Land-Hungry|Cannot Bear Waste|Wary of Landlords',
    'The family that took you in|A neighbour who shared a well', 'A share of a harvest|A plot of your own', 'The field that was lost|A landlord\'s promise'],
  ['hermit', 'The wilds', 'The Hermit', 'You lived apart, by choice or by sentence, and came back different.',
    'hermit|alone|solitude|exile|cave|mountain|isolated|wander|outcast|recluse|remote', 'Foraging|Enduring Hardship|Meditation|Making Do', 'Self-Contained|Calm|Deeply Observant|Frugal', 'Uneasy in Crowds|Speaks Rarely|Does Not Trust Kindness',
    'A traveller who found you and stayed|A voice that wrote to you', 'A hidden shelter|A map in your head', 'The reason you left|Something you swore never to return to'],

  // ---- the streets
  ['street-kid', 'The streets', 'The Gutter Child', 'You grew up in alleys, learning what grown-ups hide.',
    'street|orphan|beggar|alley|urchin|poor|gutter|slum|rags|gang|scrounge|pickpocket', 'Pickpocketing|Scrounging|Reading Danger|Climbing', 'Quick|Streetwise|Resourceful|Loyal to Friends', 'Cannot Trust a Kind Word|Hoards Food|Fights Dirty',
    'An older kid who looked out for you|A shopkeeper who fed you', 'A hiding place only you know|A scrap of a lucky charm', 'The friend you left behind|A theft that cost someone more than you knew'],
  ['gambler', 'The streets', 'The Gambler', 'You lived on odds, nerve and the next hand.',
    'gamble|gambler|dice|cards|bet|odds|wager|tavern|luck|game|cheat', 'Gambling|Bluffing|Counting Odds|Sleight of Hand', 'Lucky|Cool-Headed|Good Company|Reads Tells', 'Cannot Walk Away|Believes in Luck|Owes a Lot',
    'A dealer who watches your back|A rival with a long memory', 'A lucky coin and a purse that swings|Credit at three tables', 'A debt you cannot pay|A hand you should not have won'],
  ['outlaw', 'The streets', 'The Outlaw', 'You lived outside the law and paid for it.',
    'outlaw|bandit|raider|thief|robber|highway|crime|criminal|mercenary|pirate|gang', 'Ambush|Intimidation|Fencing Goods|Evading Pursuit', 'Daring|Ruthless When Needed|Loyal to the Crew|Lives for the Moment', 'Wanted|Trusts No One|Cannot Stay Honest',
    'A crew-mate who knows where you are|A lawman who never stopped looking', 'A cache of stolen goods|A safe house', 'The job that went wrong|The person you left to take the fall'],

  // ---- title and standing
  ['noble-house', 'Standing and service', 'The Household Servant', 'You served in a great house and saw how its people really behaved.',
    'servant|house|noble|lord|lady|steward|butler|maid|court|manor|estate|household|page', 'Etiquette|Overhearing|Serving Quietly|Managing a Household', 'Discreet|Observant|Well Mannered|Loyal', 'Cannot Speak Up|Bows Too Easily|Resents the Great',
    'A noble who trusted you|A fellow servant who told you things', 'A reference from a great house|A small purse of savings', 'A secret overheard|A master\'s last request'],
  ['envoy', 'Standing and service', 'The Envoy', 'You carried words between people who would not meet.',
    'envoy|diplomat|ambassador|negotiate|treaty|peace|embassy|delegate|messenger|parley|talks', 'Negotiation|Languages|Protocol|Reading a Room', 'Diplomatic|Patient|Slow to Anger|Well Travelled', 'Trusts No Treaty|Speaks in Riddles|Sells Both Sides',
    'A counterpart who respects you|An aide who learned from you', 'Letters of safe conduct|A seal of office', 'A treaty that failed|A message that was changed'],
  ['guild-hand', 'Standing and service', 'The Guild Hand', 'You belonged to a trade association with rules, dues and quiet power.',
    'guild|union|dues|member|association|apprentice|journeyman|trade|brotherhood|charter|craftsman', 'Guild Law|Negotiating Wages|Organising|Craftsmanship', 'Loyal to the Guild|Well Organised|Fair Dealer|Stubborn', 'Bound by Oaths|Cannot Cross a Brother|Resents Outsiders',
    'A guildmaster who sponsored you|A rival guild\'s journeyman', 'Guild dues paid and a place at the hall|A cart of trade goods', 'A rule you broke|A brother you reported'],
];

export const CHAPTER_LIBRARY: readonly ChapterTemplate[] = SEEDS.map(make);
export const templateById = (id: string): ChapterTemplate | undefined => CHAPTER_LIBRARY.find((t) => t.id === id);

const tokens = (s: string): string[] => s.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2);

export type MatchTier = 'close' | 'partial' | 'none';
export interface TemplateMatch { template: ChapterTemplate; score: number; tier: MatchTier }

/** Distinct keywords that appear in the prose, as a share of the template's keywords (keyword stems count: "guarded" matches "guard"). */
export function scoreTemplate(prose: string, t: ChapterTemplate): number {
  const words = tokens(prose);
  if (!words.length) return 0;
  const hit = t.keywords.filter((k) => words.some((w) => w === k || (k.length >= 4 && (w.startsWith(k) || k.startsWith(w) && w.length >= 4)))).length;
  return hit;
}

/** Templates ranked by how many of their keywords the chapter mentions. Two or more is "close", one is "partial". Deterministic. */
export function matchTemplates(prose: string, summary = ''): TemplateMatch[] {
  const text = `${summary} ${prose}`;
  return CHAPTER_LIBRARY
    .map((template) => { const score = scoreTemplate(text, template); return { template, score, tier: (score >= 2 ? 'close' : score === 1 ? 'partial' : 'none') as MatchTier }; })
    .sort((a, b) => b.score - a.score || a.template.id.localeCompare(b.template.id));
}
