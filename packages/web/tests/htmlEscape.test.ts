// Regression tests for audit finding F-1 (stored XSS in PDF/print exports).
// Payloads are synthetic markers only -- never real JWT values, never production data.
import { describe, it, expect } from 'vitest';
import { escapeHtml } from '@/utils/htmlEscape';

describe('escapeHtml', () => {
  it('encodes a <script> payload so no executable script tag survives', () => {
    const out = escapeHtml('<script>window.__xss_test = true</script>');
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('</script>');
    expect(out).toBe('&lt;script&gt;window.__xss_test = true&lt;/script&gt;');
  });

  it('encodes an event-handler payload so no element/attribute is created', () => {
    const out = escapeHtml('<img src=x onerror="window.__xss_test=true">');
    // No real <img> tag exists in the output -- "onerror=" surviving as inert text
    // (with its quotes encoded) is safe and expected; it can never attach as a real
    // attribute without a real element for it to belong to.
    expect(out).not.toMatch(/<img/i);
    expect(out).toBe('&lt;img src=x onerror=&quot;window.__xss_test=true&quot;&gt;');
  });

  it('encodes a closing-tag injection payload so it cannot escape a surrounding <style>/<script> block', () => {
    const out = escapeHtml('</style><script>window.__xss_test = true</script>');
    expect(out).not.toContain('</style>');
    expect(out).not.toContain('<script>');
    expect(out).toBe('&lt;/style&gt;&lt;script&gt;window.__xss_test = true&lt;/script&gt;');
  });

  it('encodes double and single quotes/apostrophes safely', () => {
    expect(escapeHtml(`He said "hi" and it's fine`)).toBe('He said &quot;hi&quot; and it&#39;s fine');
  });

  it('encodes ampersands without double-encoding existing entities incorrectly', () => {
    expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
  });

  it('returns an empty string for null/undefined rather than the literal text "null"/"undefined"', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('safely stringifies non-string values (numbers) with no escaping needed', () => {
    expect(escapeHtml(42)).toBe('42');
  });
});

describe('escapeHtml applied to representative printable-record payloads', () => {
  // These mirror how the PDF-builder functions in admin/pages/{Customers,CustomerDetail,
  // Reports,Expenses}.tsx now wrap every database-controlled field, e.g.
  // `<div class="cname">${esc(c.name)}</div>`.

  it('a malicious customer name is encoded when interpolated into customer PDF HTML', () => {
    const customerName = '<script>window.__xss_test = true</script>';
    const html = `<div class="cname">${escapeHtml(customerName)}</div>`;
    expect(html).toBe('<div class="cname">&lt;script&gt;window.__xss_test = true&lt;/script&gt;</div>');
    expect(html).not.toContain('<script>');
  });

  it('a malicious notes payload is encoded when interpolated into printable HTML', () => {
    const notes = '<img src=x onerror="window.__xss_test=true">';
    const html = `<p style="font-size:11px;margin:0">${escapeHtml(notes)}</p>`;
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain('&lt;img src=x onerror=&quot;window.__xss_test=true&quot;&gt;');
  });

  it('a malicious expense description is encoded when interpolated into invoice HTML', () => {
    const description = '<script>window.__xss_test = true</script>';
    const html = `<div class="val" style="font-weight:normal">${escapeHtml(description)}</div>`;
    expect(html).not.toContain('<script>');
  });

  it('a malicious report free-text field (search filter reflected into report header) is encoded', () => {
    const search = '<script>window.__xss_test = true</script>';
    const filterSummary = `Search: ${search}`;
    const html = `<div class="meta">Filters: ${escapeHtml(filterSummary)}</div>`;
    expect(html).not.toContain('<script>');
  });

  it('generated printable HTML still contains the intended application-controlled markup around the encoded value', () => {
    const customerName = 'Al-Rashid Villa';
    const html = `<!DOCTYPE html><html><body><div class="cname">${escapeHtml(customerName)}</div></body></html>`;
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<div class="cname">Al-Rashid Villa</div>');
    expect(html).toContain('</body></html>');
  });
});
