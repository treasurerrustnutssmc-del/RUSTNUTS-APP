/**
 * The club rules for chats and posts as a public web page (site/posting-rules.html): the terms
 * App Review reads, and the text that goes into App Store Connect as the licence agreement.
 * `npm run build:privacy` writes it beside the privacy policy.
 */
import { renderPolicyPage } from './policyPage';
import {
  POSTING_RULES_EMAIL,
  POSTING_RULES_INTRO,
  POSTING_RULES_SECTIONS,
  POSTING_RULES_TITLE,
  POSTING_RULES_URL,
  postingRulesUpdatedLine,
  type RulesSection,
} from './postingRules';

export function renderPostingRulesPage(sections: RulesSection[] = POSTING_RULES_SECTIONS): string {
  return renderPolicyPage({
    title: `Rustnuts app: ${POSTING_RULES_TITLE.toLowerCase()}`,
    heading: POSTING_RULES_TITLE,
    description: 'What every member of the Rustnuts Social Motorcycle Club agrees to before posting in the club app: no tolerance for objectionable content or abusive members, how to report and block, and what happens within 24 hours.',
    url: POSTING_RULES_URL,
    updatedLine: postingRulesUpdatedLine(),
    intro: POSTING_RULES_INTRO,
    sections,
    email: POSTING_RULES_EMAIL,
    movedTo: POSTING_RULES_URL,
  });
}
