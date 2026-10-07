/** A solo draft is a private document named `<campaign>~draft~<user>`. Anything else is the campaign's shared story. */
const DRAFT = /^([A-Za-z0-9_-]{1,64})~draft~([A-Za-z0-9_-]{1,64})$/;

export const draftName = (campaign: string, userId: string) => `${campaign}~draft~${userId}`;
/** The user a draft document belongs to, or null for a campaign document. */
export const draftOwner = (name: string): string | null => DRAFT.exec(name)?.[2] ?? null;
/** The campaign a document belongs to. */
export const campaignOf = (name: string): string => DRAFT.exec(name)?.[1] ?? name;
