// Regression tests for audit finding F-2 (vulnerable xlsx@0.18.5 replaced with
// exceljs). Verifies the shared write-only export helper produces workbooks
// exceljs itself can read back correctly, and that a formula-like value in a
// free-text field (customer name/notes) cannot become an executable
// spreadsheet formula when the exported file is later opened.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import { downloadExcelWorkbook } from '@/utils/excelExport';

let capturedBuffer: any;
let capturedFilename: string;
const OriginalBlob = globalThis.Blob;

beforeEach(() => {
  capturedBuffer = null;
  capturedFilename = '';
  // jsdom's Blob does not implement .arrayBuffer(), so a real round-trip
  // through Blob isn't possible here -- capture the raw buffer passed into
  // the Blob constructor instead, which is exactly what downloadExcelWorkbook
  // hands to `new Blob([buffer], {...})`.
  (globalThis as any).Blob = class {
    constructor(parts: any[]) { capturedBuffer = parts[0]; }
  };
  // jsdom does not implement URL.createObjectURL/revokeObjectURL at all, so
  // there is no existing method for vi.spyOn to wrap -- assign stubs directly.
  (URL as any).createObjectURL = () => 'blob:mock-url';
  (URL as any).revokeObjectURL = () => {};
  const originalCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const el = originalCreateElement(tag);
    if (tag === 'a') {
      Object.defineProperty(el, 'click', {
        value: () => { capturedFilename = (el as HTMLAnchorElement).download; },
        configurable: true,
      });
    }
    return el;
  });
});

afterEach(() => {
  globalThis.Blob = OriginalBlob;
});

async function readBackWorkbook(): Promise<ExcelJS.Workbook> {
  expect(capturedBuffer).not.toBeNull();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(capturedBuffer);
  return wb;
}

describe('downloadExcelWorkbook', () => {
  it('triggers a download with the requested filename', async () => {
    await downloadExcelWorkbook([{ name: 'Customers', rows: [{ Name: 'Ali' }] }], 'customers-test.xlsx');
    expect(capturedFilename).toBe('customers-test.xlsx');
  });

  it('produces a workbook with the expected worksheet name and header row', async () => {
    await downloadExcelWorkbook([
      { name: 'Customers', rows: [{ Name: 'Ali', Phone: '0501234567' }] },
    ], 'test.xlsx');
    const wb = await readBackWorkbook();
    const ws = wb.getWorksheet('Customers');
    expect(ws).toBeDefined();
    expect((ws!.getRow(1).values as any[]).slice(1)).toEqual(['Name', 'Phone']);
  });

  it('exports representative row values correctly', async () => {
    await downloadExcelWorkbook([
      { name: 'Customers', rows: [{ Name: 'Fahad Al-Rashid', Phone: '0501234567', City: 'Riyadh' }] },
    ], 'test.xlsx');
    const wb = await readBackWorkbook();
    const ws = wb.getWorksheet('Customers')!;
    expect((ws.getRow(2).values as any[]).slice(1)).toEqual(['Fahad Al-Rashid', '0501234567', 'Riyadh']);
  });

  it('preserves Arabic text in worksheet names, headers, and values', async () => {
    await downloadExcelWorkbook([
      { name: 'العملاء', rows: [{ 'الاسم': 'محمد العتيبي', 'الجوال': '0559876543' }] },
    ], 'test-ar.xlsx');
    const wb = await readBackWorkbook();
    const ws = wb.getWorksheet('العملاء');
    expect(ws).toBeDefined();
    expect((ws!.getRow(1).values as any[]).slice(1)).toEqual(['الاسم', 'الجوال']);
    expect((ws!.getRow(2).values as any[]).slice(1)).toEqual(['محمد العتيبي', '0559876543']);
  });

  it('retains numeric amounts as numbers, not strings', async () => {
    await downloadExcelWorkbook([{ name: 'Sales', rows: [{ Customer: 'Test', Amount: 1234.5 }] }], 'test.xlsx');
    const wb = await readBackWorkbook();
    const cell = wb.getWorksheet('Sales')!.getRow(2).getCell(2);
    expect(cell.value).toBe(1234.5);
    expect(typeof cell.value).toBe('number');
  });

  it('supports multiple worksheets in one workbook (Regular/Urgent appointment export)', async () => {
    await downloadExcelWorkbook([
      { name: 'Regular', rows: [{ Kind: 'Regular', Customer: 'A' }] },
      { name: 'Urgent', rows: [{ Kind: 'Urgent', Customer: 'B' }] },
    ], 'appointments-test.xlsx');
    const wb = await readBackWorkbook();
    expect(wb.worksheets.map((w) => w.name).sort()).toEqual(['Regular', 'Urgent']);
  });

  it('applies the requested column widths', async () => {
    await downloadExcelWorkbook([
      { name: 'Customers', rows: [{ Name: 'Ali' }], colWidths: [28] },
    ], 'test.xlsx');
    const wb = await readBackWorkbook();
    expect(wb.getWorksheet('Customers')!.getColumn(1).width).toBe(28);
  });

  describe('formula-injection neutralization', () => {
    it('neutralizes a formula-like customer name so it is stored as text, not a formula', async () => {
      const payload = "=cmd|'/c calc'!A1";
      await downloadExcelWorkbook([{ name: 'Customers', rows: [{ Name: payload, Phone: '0501234567' }] }], 'test.xlsx');
      const wb = await readBackWorkbook();
      const cell = wb.getWorksheet('Customers')!.getRow(2).getCell(1);
      expect(cell.type).not.toBe(ExcelJS.ValueType.Formula);
      // A leading apostrophe is prepended -- this is a deliberate, visible change
      // to the displayed text for any value that starts with =, +, -, or @, in
      // exchange for it never being interpreted as an executable formula.
      expect(cell.value).toBe(`'${payload}`);
    });

    it('neutralizes values starting with +, -, or @ the same way', async () => {
      await downloadExcelWorkbook([{
        name: 'Notes',
        rows: [{ A: '+1+1', B: '-2+3', C: '@SUM(A1:A2)' }],
      }], 'test.xlsx');
      const wb = await readBackWorkbook();
      const row = wb.getWorksheet('Notes')!.getRow(2);
      expect(row.getCell(1).value).toBe("'+1+1");
      expect(row.getCell(2).value).toBe("'-2+3");
      expect(row.getCell(3).value).toBe("'@SUM(A1:A2)");
    });

    it('does not alter a normal Saudi phone number (server-validated ^05\\d{8}$, never starts with +)', async () => {
      await downloadExcelWorkbook([{ name: 'Customers', rows: [{ Phone: '0501234567' }] }], 'test.xlsx');
      const wb = await readBackWorkbook();
      expect(wb.getWorksheet('Customers')!.getRow(2).getCell(1).value).toBe('0501234567');
    });

    it('leaves ordinary text containing (not starting with) a hyphen untouched', async () => {
      await downloadExcelWorkbook([{ name: 'Customers', rows: [{ City: 'Al-Khobar' }] }], 'test.xlsx');
      const wb = await readBackWorkbook();
      expect(wb.getWorksheet('Customers')!.getRow(2).getCell(1).value).toBe('Al-Khobar');
    });

    it('leaves an empty string untouched', async () => {
      await downloadExcelWorkbook([{ name: 'Customers', rows: [{ Notes: '' }] }], 'test.xlsx');
      const wb = await readBackWorkbook();
      expect(wb.getWorksheet('Customers')!.getRow(2).getCell(1).value).toBe('');
    });
  });
});

describe('no vulnerable xlsx import remains in active export source', () => {
  const xlsxImportPattern = /from\s+["']xlsx["']|import\(\s*["']xlsx["']\s*\)|require\(\s*["']xlsx["']\s*\)/;
  const filesToCheck = [
    '../../unified-app/src/utils/excelExport.ts',
    '../../unified-app/src/admin/pages/Reports.tsx',
    '../../unified-app/src/admin/pages/Customers.tsx',
  ];

  for (const relPath of filesToCheck) {
    it(`${relPath} does not import the vulnerable xlsx package`, () => {
      const source = fs.readFileSync(path.resolve(__dirname, relPath), 'utf-8');
      expect(source).not.toMatch(xlsxImportPattern);
    });
  }
});
