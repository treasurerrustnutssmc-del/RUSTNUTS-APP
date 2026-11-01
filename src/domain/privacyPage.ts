/**
 * The privacy policy as a public web page (site/privacy.html). The look and the HTML live in
 * policyPage.ts, shared with the club rules for chats and posts. `npm run build:privacy` writes
 * both.
 */
import { renderPolicyPage } from './policyPage';
import {
  PRIVACY_EMAIL,
  PRIVACY_INTRO,
  PRIVACY_SECTIONS,
  PRIVACY_URL,
  privacyUpdatedLine,
  type PrivacySection,
} from './privacyPolicy';

export function renderPrivacyPage(sections: PrivacySection[] = PRIVACY_SECTIONS): string {
  return renderPolicyPage({
    title: 'Rustnuts app privacy policy',
    heading: 'App privacy policy',
    description: 'How the Rustnuts Social Motorcycle Club app collects, uses and protects your information.',
    url: PRIVACY_URL,
    updatedLine: privacyUpdatedLine(),
    intro: PRIVACY_INTRO,
    sections,
    email: PRIVACY_EMAIL,
    movedTo: PRIVACY_URL,
  });
}
