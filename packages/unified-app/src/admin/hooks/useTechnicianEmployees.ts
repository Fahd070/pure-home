import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

/**
 * The single client-side entry point for technician employee records.
 *
 * Administration reaches these records from two different screens -- Employees
 * (full management) and Access Codes (credential management) -- and the
 * requirement is explicit that they must operate on the SAME records, not two
 * lists that can disagree. Putting the query key and every mutation here, rather
 * than in each page, is what makes that structurally true: both screens read one
 * cache entry, and any mutation from either invalidates it for both.
 *
 * The server never returns an access-code hash, so there is nothing to guard
 * against here -- `hasAccessCode` is the only credential state that exists on
 * the client (see routes/employees.ts).
 */

export interface TechnicianEmployee {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  /** Masked credential state. There is deliberately no way to read the code. */
  hasAccessCode: boolean;
  accessCodeSetAt: string | null;
  createdAt: string;
}

export interface TechnicianMigrationStatus {
  sharedLoginRetired: boolean;
  canCompleteCutover: boolean;
  blockedReason: "NO_INDIVIDUAL_TECHNICIANS" | "TECHNICIANS_WITHOUT_CODE" | null;
  techniciansWithoutCode: number;
}

const TECHNICIAN_EMPLOYEES_KEY = ["technician-employees"];
const TECHNICIAN_MIGRATION_KEY = ["technician-migration"];

export function useTechnicianEmployees() {
  const qc = useQueryClient();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: TECHNICIAN_EMPLOYEES_KEY });
    // The Access Codes screen reads the same roster through its own endpoint,
    // so it has to be refreshed by the same mutations.
    qc.invalidateQueries({ queryKey: TECHNICIAN_MIGRATION_KEY });
    qc.invalidateQueries({ queryKey: ["access-codes"] });
  };

  const list = useQuery<TechnicianEmployee[]>({
    queryKey: TECHNICIAN_EMPLOYEES_KEY,
    queryFn: () => api.get("/employees/technicians").then(r => r.data.data || []),
    // No `initialData`: supplying [] made `isLoading` permanently false, so the
    // loading branch was dead and the page flashed "no technicians" before the
    // first fetch resolved.
  });

  /**
   * Migration status for the legacy shared login.
   *
   * Read from the server, never re-derived here. Retirement is durable one-way
   * state and cutover eligibility deliberately excludes the legacy account, so a
   * roster snapshot in the browser cannot represent either correctly.
   */
  const migration = useQuery<TechnicianMigrationStatus>({
    queryKey: TECHNICIAN_MIGRATION_KEY,
    queryFn: () => api.get("/employees/technician-migration").then(r => r.data.data),
  });

  /** The one-way cutover. There is deliberately no inverse mutation. */
  const completeCutover = useMutation({
    mutationFn: () => api.post("/employees/technician-cutover").then(r => r.data.data),
    onSuccess: invalidate,
  });

  const create = useMutation({
    mutationFn: (body: { name: string; accessCode?: string }) =>
      api.post("/employees/technicians", body).then(r => r.data.data),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; isActive?: boolean }) =>
      api.patch(`/employees/technicians/${id}`, body).then(r => r.data.data),
    onSuccess: invalidate,
  });

  const setAccessCode = useMutation({
    mutationFn: ({ id, newCode, confirmCode }: { id: string; newCode: string; confirmCode: string }) =>
      api.put(`/employees/technicians/${id}/access-code`, { newCode, confirmCode }).then(r => r.data.data),
    onSuccess: invalidate,
  });

  return { list, migration, completeCutover, create, update, setAccessCode };
}

/**
 * Maps a server error code to an i18n key, so both screens report the same
 * failure the same way instead of each inventing its own wording.
 */
export function employeeErrorKey(err: any): string {
  const code = err?.response?.data?.error;
  if (code === "CODE_TAKEN") return "employees.errCodeTaken";
  if (code === "MISMATCH") return "employees.errMismatch";
  if (code === "VALIDATION") return "employees.errValidation";
  if (code === "NO_INDIVIDUAL_TECHNICIANS") return "employees.errNoTechnicians";
  if (code === "TECHNICIANS_WITHOUT_CODE") return "employees.errTechniciansWithoutCode";
  if (code === "BUSY") return "employees.errBusy";
  return "common.error";
}
