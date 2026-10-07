import { randomInt } from 'node:crypto';
import type { DiceSource } from '@quillquest/rules';

/** Where dice come from. Production rolls with the system's CSPRNG; dev and e2e can queue the next values. */
export interface DiceProvider {
  forCampaign(campaign: string): DiceSource;
  /** Dev only: the next dice thrown in this campaign, in order, before falling back to random. */
  queue(campaign: string, values: number[]): void;
}

export const cryptoDice = (): DiceSource => ({ d: (sides) => randomInt(1, sides + 1) });

export class QueuedDice implements DiceProvider {
  private queues = new Map<string, number[]>();
  forCampaign(campaign: string): DiceSource {
    return {
      d: (sides) => {
        const next = this.queues.get(campaign)?.shift();
        if (next === undefined) return randomInt(1, sides + 1);
        if (!Number.isInteger(next) || next < 1 || next > sides) throw new Error(`queued die ${next} is not on a d${sides}`);
        return next;
      },
    };
  }
  queue(campaign: string, values: number[]) {
    this.queues.set(campaign, [...(this.queues.get(campaign) ?? []), ...values]);
  }
}
