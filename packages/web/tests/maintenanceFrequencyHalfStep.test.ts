// Focused modification batch (Part D): frontend half-month-step validator,
// mirroring the backend's isHalfMonthStep (routes/customers.ts). Single
// source of truth for both Add Customer forms (admin/pages/AddCustomer.tsx,
// scheduling/pages/AddCustomer.tsx).
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { isValidMaintenanceFrequency } from '@/utils/maintenanceFrequency';

describe('isValidMaintenanceFrequency', () => {
  it.each([1, 1.5, 2, 2.5, 3, 3.5, 10, 0.5])('accepts %s', (v) => {
    expect(isValidMaintenanceFrequency(v)).toBe(true);
  });

  it.each([1.2, 2.37, 0.3, 1.1, NaN, Infinity, -Infinity])('rejects %s', (v) => {
    expect(isValidMaintenanceFrequency(v)).toBe(false);
  });

  it('rejects zero', () => {
    expect(isValidMaintenanceFrequency(0)).toBe(false);
  });

  it('rejects negative values, including a valid-step magnitude', () => {
    expect(isValidMaintenanceFrequency(-1)).toBe(false);
    expect(isValidMaintenanceFrequency(-1.5)).toBe(false);
  });

  it('is not fooled by floating-point representation noise around an exact half-step', () => {
    // 0.1 + 0.2 style float drift, landing extremely close to but not exactly on 1.5.
    expect(isValidMaintenanceFrequency(1.5 + Number.EPSILON)).toBe(true);
  });
});

describe('Add Customer forms use step=0.5 and the shared half-month validator (source-level)', () => {
  it('28. Admin Add Customer form', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/admin/pages/AddCustomer.tsx'), 'utf-8');
    expect(src).toMatch(/from ["']\.\.\/\.\.\/utils\/maintenanceFrequency["']/);
    expect(src).toMatch(/step=\{0\.5\}/);
    expect(src).not.toMatch(/type="number" min=\{1\}.*maintenanceFrequency/);
  });

  it('29. Scheduling Add Customer form', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/scheduling/pages/AddCustomer.tsx'), 'utf-8');
    expect(src).toMatch(/from ["']\.\.\/\.\.\/utils\/maintenanceFrequency["']/);
    expect(src).toMatch(/step=\{0\.5\}/);
    expect(src).not.toMatch(/type="number" min=\{1\}.*maintenanceFrequency/);
  });
});
