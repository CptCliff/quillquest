/** Thrown when a call would break an enforced (countable) rule. The GM may override in the app; the engine never does. */
export class RuleViolation extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'RuleViolation';
  }
}
