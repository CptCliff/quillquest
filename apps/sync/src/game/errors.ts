/** A problem that is not a rule breach: missing things, wrong role for a route, bad input. */
export class GameError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'GameError';
  }
}
