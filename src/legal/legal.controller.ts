import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import {
  PRIVACY_POLICY,
  TERMS_OF_SERVICE,
  type LegalDocument,
} from './legal-docs';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Human-readable HTML rendering of the same legal documents served as JSON.
 * Used as the public Privacy Policy / Terms URLs for OAuth brand verification.
 */
function renderDocument(doc: LegalDocument): string {
  const sections = doc.sections
    .map(
      (s) => `<section><h2>${escapeHtml(s.heading)}</h2><p>${escapeHtml(s.body)}</p></section>`,
    )
    .join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(doc.title)} — Internal Operations Hub</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;line-height:1.6;color:#1a1a1a}h1{font-size:1.6rem}h2{font-size:1.15rem;margin-top:1.6rem}.meta{color:#666;font-size:.9rem}</style>
</head>
<body>
<h1>${escapeHtml(doc.title)}</h1>
<p class="meta">Internal Operations Hub · Last updated ${escapeHtml(doc.updatedAt)}</p>
<p>${escapeHtml(doc.intro)}</p>
${sections}
</body>
</html>`;
}

@Public()
@Controller('legal')
export class LegalController {
  @Get('privacy')
  privacy() {
    return PRIVACY_POLICY;
  }

  @Get('terms')
  terms() {
    return TERMS_OF_SERVICE;
  }

  @Get('privacy.html')
  @Header('Content-Type', 'text/html; charset=utf-8')
  privacyHtml(): string {
    return renderDocument(PRIVACY_POLICY);
  }

  @Get('terms.html')
  @Header('Content-Type', 'text/html; charset=utf-8')
  termsHtml(): string {
    return renderDocument(TERMS_OF_SERVICE);
  }
}
