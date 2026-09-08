import type { CanvasPresentInput } from '../../src/contracts/display.js';

export interface SyntheticEmailFixture {
  input: CanvasPresentInput;
  visibleHeaders: string[];
  omittedHeaders: string[];
  sourceBody: string;
  recommendation: string;
}

const SOURCE_BODY =
  'The synthetic launch review is scheduled for Tuesday at 10:00 AM. Please bring the accessibility checklist.';
const RECOMMENDATION =
  'Assistant recommendation: Confirm attendance and prepare the accessibility checklist before Tuesday.';

export function createSyntheticEmailFixture(options?: {
  omitRecipientAndDate?: boolean;
}): SyntheticEmailFixture {
  const omitRecipientAndDate = options?.omitRecipientAndDate ?? false;
  const headers = [
    '<dt>From</dt><dd>Alex Example &lt;alex@example.test&gt;</dd>',
    ...(omitRecipientAndDate
      ? []
      : [
          '<dt>To</dt><dd>Taylor Example &lt;taylor@example.test&gt;</dd>',
          '<dt>Date</dt><dd>Tuesday, September 8, 2026 at 9:30 AM</dd>',
        ]),
    '<dt>Subject</dt><dd>Synthetic launch review</dd>',
  ];

  return {
    input: {
      title: 'Synthetic launch review',
      html:
        '<article class="message">' +
        '<header><p class="source-label">Synthetic source message</p>' +
        `<dl class="headers">${headers.join('')}</dl></header>` +
        `<section class="source-body"><p>${SOURCE_BODY}</p></section>` +
        '<section class="recommendation">' +
        `<h2>Assistant recommendation</h2><p>${RECOMMENDATION}</p>` +
        '</section></article>',
      css:
        '.message { max-width: 52rem; margin: 0 auto; }' +
        '.source-label { color: #57606a; font-size: 0.875rem; text-transform: uppercase; }' +
        '.headers { display: flex; flex-wrap: wrap; gap: 0.35rem 1rem; padding: 1rem; border: 1px solid #d0d7de; border-radius: 0.5rem; }' +
        '.headers dt { font-weight: 700; }' +
        '.headers dd { margin: 0; }' +
        '.source-body { padding: 1rem 0; line-height: 1.6; }' +
        '.recommendation { margin-top: 1rem; padding: 1rem; border: 2px solid #8250df; border-radius: 0.5rem; background-color: #fbefff; }' +
        '.recommendation h2 { color: #6639ba; }',
    },
    visibleHeaders: omitRecipientAndDate
      ? ['From', 'Subject']
      : ['From', 'To', 'Date', 'Subject'],
    omittedHeaders: omitRecipientAndDate ? ['To', 'Date'] : [],
    sourceBody: SOURCE_BODY,
    recommendation: RECOMMENDATION,
  };
}
