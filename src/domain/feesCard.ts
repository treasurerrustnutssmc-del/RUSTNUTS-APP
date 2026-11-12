// Home's Fees card used to take a big card with a $125.00 headline even when nothing was due for months.
// It is the full card when the fee is overdue or due within 30 days, and one calm row otherwise.
import { daysBetween } from './dates';

export const FEES_FULL_WITHIN_DAYS = 30;

export function feesCardMode(firstDueOn: string, today: string): 'full' | 'compact' {
  return daysBetween(today, firstDueOn) <= FEES_FULL_WITHIN_DAYS ? 'full' : 'compact';
}
