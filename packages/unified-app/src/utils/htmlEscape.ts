// Shared output-encoding helper for building printable HTML (PDF export, print
// preview). Any database-controlled or user-controlled text (customer names,
// notes, addresses, phone numbers, expense descriptions, report free-text, etc.)
// must pass through this before being interpolated into an HTML template string --
// stored data is never trusted to be safe markup.
//
// This is the actual security boundary for the PDF/print templates: input
// validation at the form layer must not be relied on instead of this.
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
