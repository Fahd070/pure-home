import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const source = (file: string) => fs.readFileSync(path.resolve(__dirname, "../../unified-app/src", file), "utf-8");

describe("customer editing and administration history", () => {
  it("routes both departments to their existing customer form in edit mode", () => {
    const app = source("App.tsx");
    expect(app).toContain('<Route path="customers/:id/edit" element={<AddCustomer />} />');
    expect(app).toContain('<Route path="customers/:id/edit" element={<SchedAddCustomer />} />');
  });

  it("loads the existing customer and updates it through the existing versioned PUT endpoint", () => {
    for (const file of ["admin/pages/AddCustomer.tsx", "scheduling/pages/AddCustomer.tsx"]) {
      const form = source(file);
      expect(form).toContain('api.get(`/customers/${id}`)');
      expect(form).toContain('api.put(`/customers/${id}`, payload)');
      expect(form).toContain('version, [INSTALL_DATE_FIELD]');
      expect(form).toContain('previousServiceDate');
    }
  });

  it("provides edit actions in both customer lists and reuses the Scheduling history component with Admin's API", () => {
    expect(source("admin/pages/Customers.tsx")).toContain('navigate(`/admin/customers/${c.id}/edit`)');
    expect(source("scheduling/pages/CustomerList.tsx")).toContain('navigate(`/scheduling/customers/${c.id}/edit`)');
    const admin = source("admin/pages/Customers.tsx");
    expect(admin).toContain('HistoryModal customer={historyModal}');
    expect(admin).toContain('apiClient={api}');
    const history = source("scheduling/pages/CustomerList.tsx");
    expect(history).toContain('export function HistoryModal');
    expect(history).toContain('apiClient.get("/customers/" + customer.id)');
  });
});
