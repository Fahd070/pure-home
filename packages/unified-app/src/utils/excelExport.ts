import ExcelJS from "exceljs";

// Neutralizes spreadsheet formula injection: a string beginning with
// =, +, -, or @ can be interpreted as a formula by Excel/LibreOffice/Sheets
// when the exported file is later opened or re-imported. Prefixing with a
// single quote forces text interpretation without altering the visible
// content in any other case. Customer phone numbers are server-validated to
// ^05\d{8}$ and never collide with this (never start with +); free-text
// fields (name, notes, address, technician name) are the actual risk.
function neutralizeFormulaValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (/^[=+\-@]/.test(value)) return `'${value}`;
  return value;
}

export interface ExcelSheetSpec {
  name: string;
  rows: Record<string, unknown>[];
  colWidths?: number[];
}

// Replaces the vulnerable xlsx (SheetJS) package for this app's write-only
// Excel export feature. Reproduces the exact subset previously used:
// header row from row-object keys, one or more worksheets per workbook,
// column widths, and an .xlsx Blob download.
export async function downloadExcelWorkbook(sheets: ExcelSheetSpec[], filename: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const headers = sheet.rows.length ? Object.keys(sheet.rows[0]) : [];
    const ws = workbook.addWorksheet(sheet.name);
    ws.columns = headers.map((h, i) => ({ header: h, key: h, width: sheet.colWidths?.[i] }));
    for (const row of sheet.rows) {
      ws.addRow(headers.map((h) => neutralizeFormulaValue(row[h])));
    }
  }
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
