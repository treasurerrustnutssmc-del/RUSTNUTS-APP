// The App Store and Google Play reviewers' login. They can't read our emailed codes, so this email and
// code open the built-in demo club on their phone instead of the live one. It only ever unlocks
// made-up members that ship inside every build, so it isn't a secret: it goes in the store review notes.

export const REVIEWER_EMAIL = 'review@rustnutssmc.com.au';
export const REVIEWER_CODE = '201977';

export function isReviewerEmail(email: string): boolean {
  return email.trim().toLowerCase() === REVIEWER_EMAIL;
}

export function isReviewerCode(code: string): boolean {
  return code.replace(/\s/g, '') === REVIEWER_CODE;
}

/** Who the review demo opens as: Spanner, a Full member (the strip at the top switches views). */
export const REVIEWER_DEMO_MEMBER = 'm-spanner';
