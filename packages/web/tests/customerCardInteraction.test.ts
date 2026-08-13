import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const source = (file: string) => fs.readFileSync(path.resolve(__dirname, "../../unified-app/src", file), "utf-8");

describe("customer card interaction", () => {
  it("makes both customer lists open their department detail route while action buttons stop propagation", () => {
    const admin = source("admin/pages/Customers.tsx");
    const scheduling = source("scheduling/pages/CustomerList.tsx");
    expect(admin).toMatch(/<tr key=\{c\.id\} onClick=\{\(\) => navigate\(`\/admin\/customers\/\$\{c\.id\}`\)\}/);
    expect(scheduling).toMatch(/<tr key=\{c\.id\} onClick=\{\(\) => navigate\(`\/scheduling\/customers\/\$\{c\.id\}`\)\}/);
    expect(admin).toMatch(/event\.stopPropagation\(\); toggle\.mutate\(c\.id\)/);
    expect(scheduling).toMatch(/event\.stopPropagation\(\); setHistoryModal\(c\)/);
  });

  it("makes both dashboard customer lists open details and keeps dashboard actions independent", () => {
    const admin = source("admin/pages/Dashboard.tsx");
    const scheduling = source("scheduling/pages/Dashboard.tsx");
    expect(admin).toMatch(/navigate\(`\/admin\/customers\/\$\{c\.id\}`\)/);
    expect(scheduling).toMatch(/navigate\(`\/scheduling\/customers\/\$\{c\.id\}`\)/);
    expect(source("components/RowActionButton.tsx")).toMatch(/event\.stopPropagation\(\); onClick\(\)/);
  });

  it("opens customer details from every linked operational appointment row with keyboard support", () => {
    const admin = source("admin/pages/Dashboard.tsx");
    const scheduling = source("scheduling/pages/Dashboard.tsx");
    expect(admin).toMatch(/onClick=\{a\.customer \? \(\) => navigate\(`\/admin\/customers\/\$\{a\.customer\.id\}`\)/);
    expect(scheduling).toMatch(/onClick=\{a\.customer \? \(\) => navigate\(`\/scheduling\/customers\/\$\{a\.customer\.id\}`\)/);
    for (const dashboard of [admin, scheduling]) {
      expect(dashboard).toMatch(/event\.key === "Enter" \|\| event\.key === " "/);
      expect(dashboard).toMatch(/tabIndex=\{a\.customer \? 0 : undefined\}/);
    }
  });

  it("uses the existing customer detail API for both roles and displays stored customer fields", () => {
    const app = source("App.tsx");
    const detail = source("admin/pages/CustomerDetail.tsx");
    expect(app).toContain('<Route path="customers/:id" element={<CustomerDetail />} />');
    expect(app).toContain('<CustomerDetail apiClient={schedulingApi} queryScope="scheduling" />');
    expect(detail).toContain('apiClient.get(`/customers/${id}`)');
    expect(detail).toContain('queryKey: ["customer", queryScope, id]');
    for (const field of ["installationDate", "lastMaintenance", "nextMaintenance", "postalCode", "apartmentNo", "secondaryPhone", "previousService", "notes"]) {
      expect(detail).toContain(field);
    }
  });
});
