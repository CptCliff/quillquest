/** A solo draft is a private document named `<campaign>~draft~<user>`. Anything else is the campaign's shared story. */
const DRAFT = /^([A-Za-z0-9_-]{1,64})~draft~([A-Za-z0-9_-]{1,64})$/;

export const draftName = (campaign: string, userId: string) => `${campaign}~draft~${userId}`;
/** The user a draft document belongs to, or null for a campaign document. */
export const draftOwner = (name: string): string | null => DRAFT.exec(name)?.[2] ?? null;
/** The campaign a document belongs to. */
export const campaignOf = (name: string): string => DRAFT.exec(name)?.[1] ?? GM_DOC.exec(name)?.[1] ?? name;

/** The GM's private notes document is named `<campaign>~gm`; only the campaign's GM may open it. */
const GM_DOC = /^([A-Za-z0-9_-]{1,64})~gm$/;
export const gmDocName = (campaign: string) => `${campaign}~gm`;
export const isGmDoc = (name: string): boolean => GM_DOC.test(name);
