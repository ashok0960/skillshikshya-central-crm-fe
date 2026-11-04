import {
  keepPreviousData,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { useDataSource } from "@/context/data-source";
import { apiErrorMessage } from "@/lib/api";
import {
  adaptApiCall,
  adaptApiActivity,
  adaptApiCourseInterest,
  adaptApiEnrollment,
  adaptApiFollowup,
  adaptApiLead,
  adaptApiLeadToListItem,
  adaptApiPayment,
  uiLeadTypeToApi,
} from "@/data/lead-adapters";
import { getLeadById, LEAD_LIST } from "@/data/mock-leads";
import { isOverdue } from "@/lib/leads-format";
import { formatCallDuration } from "@/lib/call-duration";
import { leadsService, type LeadListParams } from "@/services/leads.service";
import type {
  ApiEnrollment,
  ApiEnrollmentPayload,
  ApiFollowup,
  ApiLeadCall,
  ApiLeadDocument,
  ApiLeadPayload,
  ApiPayment,
  ApiPaymentPayload,
  EnrollmentListParams,
  PaymentListParams,
} from "@/types/leads-api";
import type { Lead, LeadListItem, LeadTypeCode } from "@/types/leads";
import type { LeadFilterState } from "@/pages/leads/components/lead-filters";

const EMPTY_PAGE = { count: 0, next: null, previous: null, results: [] };

/* ------------------------------------------------- filter translation */

export function buildApiParams(
  f: LeadFilterState,
  page: number,
  pageSize: number,
  ordering: string,
): LeadListParams {
  const p: LeadListParams = { page, page_size: pageSize, ordering };
  if (f.search.trim()) p.search = f.search.trim();
  if (f.status !== "all") p.status = Number(f.status);
  if (f.source !== "all") p.source = Number(f.source);
  if (f.priority !== "all") p.priority = Number(f.priority);
  if (f.course !== "all") p.primary_course = Number(f.course);
  if (f.type !== "all") {
    // Live backend: numeric lead-type FK id. Mock: legacy string enum.
    p.lead_type = /^\d+$/.test(f.type) ? Number(f.type) : uiLeadTypeToApi(f.type as LeadTypeCode);
  }
  if (f.assignedTo !== "all" && f.assignedTo !== "unassigned") {
    p.assigned_counselor = Number(f.assignedTo);
  }
  if (f.overdueOnly) p.next_followup_at__lte = new Date().toISOString();
  // Date-only created filters — the backend's `from_date`/`to_date` and
  // `created_date` are inclusive whole days, so no timezone juggling is needed.
  if (f.createdDate) p.created_date = f.createdDate;
  if (f.dateFrom) p.from_date = f.dateFrom;
  if (f.dateTo) p.to_date = f.dateTo;
  return p;
}

/** Client-side matcher for the mock dataset (string codes). */
export function mockMatch(l: LeadListItem, f: LeadFilterState): boolean {
  if (l.isArchived) return false;
  if (f.status !== "all" && l.status !== f.status) return false;
  if (f.source !== "all" && l.source !== f.source) return false;
  if (f.type !== "all" && l.leadType !== f.type) return false;
  if (f.priority !== "all" && l.priority !== f.priority) return false;
  if (f.assignedTo === "unassigned" && l.assignedTo !== null) return false;
  if (f.assignedTo !== "all" && f.assignedTo !== "unassigned" && l.assignedTo !== f.assignedTo)
    return false;
  if (f.unassignedOnly && l.assignedTo !== null) return false;
  if (f.overdueOnly && !(l.nextFollowUpAt && isOverdue(l.nextFollowUpAt) && l.status !== "enrolled"))
    return false;
  if (f.course !== "all" && l.primaryCourseId !== f.course) return false;
  // createdAt is an ISO timestamp; compare on the date part so the range is inclusive.
  const createdDay = l.createdAt.slice(0, 10);
  if (f.createdDate && createdDay !== f.createdDate) return false;
  if (f.dateFrom && createdDay < f.dateFrom) return false;
  if (f.dateTo && createdDay > f.dateTo) return false;
  if (f.search.trim()) {
    const q = f.search.trim().toLowerCase();
    const hay = `${l.fullName} ${l.primaryPhone} ${l.email ?? ""} ${l.referenceNumber}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

/* ------------------------------------------------------------- list hook */

export interface LeadsListResult {
  items: LeadListItem[];
  count: number;
  isLoading: boolean;
  isFetching: boolean;
}

export function useLeadsList(
  filters: LeadFilterState,
  page: number,
  pageSize: number,
  ordering = "-created_at",
): LeadsListResult {
  const { source } = useDataSource();
  const isApi = source === "api";
  const apiParams = buildApiParams(filters, page, pageSize, ordering);

  const query = useQuery({
    queryKey: ["leads", "list", apiParams],
    queryFn: () => leadsService.list(apiParams),
    enabled: isApi,
    placeholderData: keepPreviousData,
  });

  if (isApi) {
    return {
      items: (query.data?.results ?? []).map(adaptApiLeadToListItem),
      count: query.data?.count ?? 0,
      isLoading: query.isLoading,
      isFetching: query.isFetching,
    };
  }

  const filtered = LEAD_LIST.filter((l) => mockMatch(l, filters));
  const start = (page - 1) * pageSize;
  return {
    items: filtered.slice(start, start + pageSize),
    count: filtered.length,
    isLoading: false,
    isFetching: false,
  };
}

/* ----------------------------------------------------------- detail hook */

export interface LeadDetailResult {
  lead: Lead | undefined;
  documents: ApiLeadDocument[];
  isLoading: boolean;
  notFound: boolean;
}

export function useLead(routeId?: string): LeadDetailResult {
  const { source } = useDataSource();
  const isApi = source === "api";
  const numId = routeId && /^\d+$/.test(routeId) ? Number(routeId) : NaN;

  const query = useQuery({
    queryKey: ["lead", "detail", routeId],
    enabled: isApi && !Number.isNaN(numId),
    queryFn: async () => {
      const [lead, calls, acts, fus, docs, interests, enrolls] = await Promise.all([
        leadsService.get(numId),
        leadsService.calls(numId).catch(() => EMPTY_PAGE),
        leadsService.activities(numId).catch(() => EMPTY_PAGE),
        leadsService.followups(numId).catch(() => EMPTY_PAGE),
        leadsService.documents(numId).catch(() => EMPTY_PAGE),
        leadsService.courseInterests(numId).catch(() => EMPTY_PAGE),
        leadsService.enrollments(numId, { ordering: "-id" }).catch(() => EMPTY_PAGE),
      ]);
      const ui = adaptApiLead(lead);
      ui.activities = [
        ...calls.results.map(adaptApiCall),
        ...acts.results.map(adaptApiActivity),
      ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
      ui.followUps = fus.results.map(adaptApiFollowup);
      if (interests.results.length) ui.courseInterests = interests.results.map(adaptApiCourseInterest);

      // `enrollments` is ordered newest-first, so results[0] is the latest one;
      // it feeds the hero/summary. The Enrollment tab lists them all via
      // `useLeadEnrollments`.
      const latestEnr = enrolls.results[0];
      if (latestEnr) {
        ui.enrollment = adaptApiEnrollment(latestEnr);
        const pays = await leadsService
          .payments(numId, latestEnr.id, { ordering: "-payment_date" })
          .catch(() => EMPTY_PAGE);
        ui.payments = pays.results.map(adaptApiPayment);
      }
      return { lead: ui, documents: docs.results as ApiLeadDocument[] };
    },
  });

  if (isApi) {
    return {
      lead: query.data?.lead,
      documents: query.data?.documents ?? [],
      isLoading: query.isLoading,
      notFound: !query.isLoading && !query.data,
    };
  }

  const lead = routeId ? getLeadById(routeId) : undefined;
  return { lead, documents: [], isLoading: false, notFound: !lead };
}

/* ------------------------------------------------------------ mutations */
// On the mock path these no-op with a toast (nothing to persist); on the API
// path they hit the backend and invalidate the relevant queries.

export function useCreateLead() {
  const { isMock } = useDataSource();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ApiLeadPayload) => {
      if (isMock) return null;
      return leadsService.create(payload);
    },
    onSuccess: (lead) => {
      if (!lead) {
        toast.success("Lead created", { description: "Mock preview — not saved to the backend." });
        return;
      }
      toast.success(`Lead "${lead.full_name}" created`);
      void qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not create lead")),
  });
}

export function useUpdateLead() {
  const { isMock } = useDataSource();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: ApiLeadPayload }) => {
      if (isMock) return null;
      return leadsService.update(id, payload);
    },
    onSuccess: (lead) => {
      if (!lead) {
        toast.success("Lead updated", { description: "Mock preview — not saved to the backend." });
        return;
      }
      toast.success("Lead updated");
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["lead"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not update lead")),
  });
}

/* --------------------------------------------------------- recycle bin */

/** A soft-deleted lead row, with the delete metadata the bin needs to show. */
export type RecycleItem = LeadListItem & { deletedAt?: string | null };

export function useRecycleBin(page: number, pageSize: number) {
  const { source } = useDataSource();
  const isApi = source === "api";
  const query = useQuery({
    queryKey: ["leads", "recycle-bin", page, pageSize],
    queryFn: () => leadsService.recycleBin({ page, page_size: pageSize }),
    enabled: isApi,
    placeholderData: keepPreviousData,
  });
  const items: RecycleItem[] = (query.data?.results ?? []).map((l) => ({
    ...adaptApiLeadToListItem(l),
    deletedAt: l.deleted_at ?? null,
  }));
  return {
    items,
    count: query.data?.count ?? 0,
    isLoading: query.isLoading,
    isApi,
  };
}

/** Undelete a soft-deleted lead (out of the recycle bin). */
export function useRestoreLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => leadsService.restore(id),
    onSuccess: () => {
      toast.success("Lead restored");
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["lead"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not restore lead")),
  });
}

/** Permanently delete a lead (staff only). Irreversible. */
export function usePurgeLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => leadsService.purge(id),
    onSuccess: () => {
      toast.success("Lead permanently deleted");
      void qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not permanently delete lead")),
  });
}

export function useDeleteLead() {
  const { isMock } = useDataSource();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      if (isMock) return;
      await leadsService.remove(id);
    },
    onSuccess: () => {
      toast.success("Lead moved to recycle bin");
      void qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not delete lead")),
  });
}

/**
 * Bulk soft-delete. The backend has no bulk endpoint (see lead-additional.md),
 * so we fan out the per-lead DELETE and report partial failures. Recoverable
 * from the recycle bin.
 */
export function useBulkDeleteLeads() {
  const { isMock } = useDataSource();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: number[]) => {
      if (isMock) return { ok: ids.length, failed: 0 };
      const results = await Promise.allSettled(ids.map((id) => leadsService.remove(id)));
      const failed = results.filter((r) => r.status === "rejected").length;
      return { ok: ids.length - failed, failed };
    },
    onSuccess: ({ ok, failed }) => {
      if (isMock) {
        toast.success(`${ok} lead${ok === 1 ? "" : "s"} removed`, {
          description: "Mock preview — not saved.",
        });
        return;
      }
      if (failed) {
        toast.warning(`Moved ${ok} to recycle bin — ${failed} could not be deleted`);
      } else {
        toast.success(`${ok} lead${ok === 1 ? "" : "s"} moved to recycle bin`);
      }
      void qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not delete leads")),
  });
}

/**
 * Bulk assign. No bulk endpoint exists, so fan out per-lead PATCH of
 * `assigned_counselor` (same field the edit form writes) and report failures.
 */
export function useBulkAssignLeads() {
  const { isMock } = useDataSource();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, counselorId }: { ids: number[]; counselorId: number }) => {
      if (isMock) return { ok: ids.length, failed: 0 };
      const results = await Promise.allSettled(
        ids.map((id) => leadsService.update(id, { assigned_counselor: counselorId })),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      return { ok: ids.length - failed, failed };
    },
    onSuccess: ({ ok, failed }) => {
      if (isMock) {
        toast.success(`${ok} lead${ok === 1 ? "" : "s"} assigned`, {
          description: "Mock preview — not saved.",
        });
        return;
      }
      if (failed) {
        toast.warning(`Assigned ${ok} — ${failed} could not be updated`);
      } else {
        toast.success(`${ok} lead${ok === 1 ? "" : "s"} assigned`);
      }
      void qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not assign leads")),
  });
}

/** Assign (or unassign) a lead's counselor — PATCH assigned_counselor. */
export function useAssignLead() {
  const { isMock } = useDataSource();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, counselorId }: { id: number; counselorId: number | null }) => {
      if (isMock) return null;
      return leadsService.update(id, { assigned_counselor: counselorId });
    },
    onSuccess: (lead) => {
      toast.success("Lead assigned", lead ? undefined : { description: "Mock preview — not saved." });
      void qc.invalidateQueries({ queryKey: ["lead"] });
      void qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not assign lead")),
  });
}

export function useAddCall(leadId?: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<ApiLeadCall>) => leadsService.addCall(leadId as number, payload),
    onSuccess: (call) => {
      toast.success("Call logged", {
        description:
          call.remaining_seconds == null
            ? undefined
            : `Remaining call balance: ${formatCallDuration(call.remaining_seconds)}`,
      });
      void qc.invalidateQueries({ queryKey: ["lead"] });
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["calls"] });
      void qc.invalidateQueries({ queryKey: ["call-minutes"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not log call")),
  });
}

/** PATCH an existing lead call (outcome/notes/next steps). */
export function useUpdateCall(leadId?: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ callId, payload }: { callId: number; payload: Partial<ApiLeadCall> }) =>
      leadsService.updateCall(leadId as number, callId, payload),
    onSuccess: () => {
      toast.success("Call updated");
      void qc.invalidateQueries({ queryKey: ["lead"] });
      void qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not update call")),
  });
}

export function useAddFollowup(leadId?: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<ApiFollowup>) => leadsService.addFollowup(leadId as number, payload),
    onSuccess: () => {
      toast.success("Follow-up scheduled");
      void qc.invalidateQueries({ queryKey: ["lead"] });
      void qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not schedule follow-up")),
  });
}

/* ------------------------------------------- enrollments & payments (live) */
// Nested under a lead: /api/leads/{lead}/enrollments/[{id}/payments/].
// See be-mds/lead_app_enrollments_payments_api_guide.md.

/** All enrollments of one lead (newest first by default). */
export function useLeadEnrollments(leadId?: number, params: EnrollmentListParams = {}) {
  const { source } = useDataSource();
  const enabled = source === "api" && leadId != null;
  const query = useQuery({
    queryKey: ["lead", "enrollments", leadId, params],
    enabled,
    queryFn: () => leadsService.enrollments(leadId as number, { ordering: "-id", ...params }),
    placeholderData: keepPreviousData,
  });
  return {
    enrollments: (query.data?.results ?? []) as ApiEnrollment[],
    count: query.data?.count ?? 0,
    isLoading: enabled && query.isLoading,
    isFetching: enabled && query.isFetching,
  };
}

/** Payments of one enrollment (newest first by default). */
export function useEnrollmentPayments(
  leadId?: number,
  enrollmentId?: number,
  params: PaymentListParams = {},
) {
  const { source } = useDataSource();
  const enabled = source === "api" && leadId != null && enrollmentId != null;
  const query = useQuery({
    queryKey: ["lead", "payments", leadId, enrollmentId, params],
    enabled,
    queryFn: () =>
      leadsService.payments(leadId as number, enrollmentId as number, {
        ordering: "-payment_date",
        page_size: 100,
        ...params,
      }),
    placeholderData: keepPreviousData,
  });
  return {
    payments: (query.data?.results ?? []) as ApiPayment[],
    isLoading: enabled && query.isLoading,
  };
}

/**
 * One payment by id — used where only the flat `/api/payments/` row is at hand
 * (it omits `notes`), so corrections start from the full record.
 */
export function usePayment(leadId?: number, enrollmentId?: number, id?: number) {
  const { source } = useDataSource();
  const enabled = source === "api" && leadId != null && enrollmentId != null && id != null;
  const query = useQuery({
    queryKey: ["lead", "payment", leadId, enrollmentId, id],
    enabled,
    queryFn: () => leadsService.payment(leadId as number, enrollmentId as number, id as number),
  });
  return { payment: query.data ?? null, isLoading: enabled && query.isLoading };
}

/**
 * Every payment of a lead, across all of its enrollments (newest first).
 * Shares the cache with `useEnrollmentPayments` (same query keys).
 */
export function useLeadPayments(leadId?: number) {
  const { source } = useDataSource();
  const isApi = source === "api";
  const { enrollments, isLoading: enrLoading } = useLeadEnrollments(leadId);

  const queries = useQueries({
    queries: enrollments.map((e) => ({
      queryKey: ["lead", "payments", leadId, e.id, {}],
      enabled: isApi && leadId != null,
      queryFn: () =>
        leadsService.payments(leadId as number, e.id, {
          ordering: "-payment_date",
          page_size: 100,
        }),
    })),
  });

  const rows = queries
    .flatMap((q, i) =>
      (q.data?.results ?? []).map((p) => ({ payment: p as ApiPayment, enrollment: enrollments[i] })),
    )
    .sort((a, b) => +new Date(b.payment.payment_date) - +new Date(a.payment.payment_date));

  return {
    rows,
    isLoading: enrLoading || queries.some((q) => q.isLoading && q.fetchStatus !== "idle"),
  };
}

export function useAddEnrollment(leadId?: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ApiEnrollmentPayload) => leadsService.addEnrollment(leadId as number, payload),
    onSuccess: () => {
      toast.success("Enrollment created");
      void qc.invalidateQueries({ queryKey: ["lead"] });
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["enrollments"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not create enrollment")),
  });
}

export function useUpdateEnrollment(leadId?: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: ApiEnrollmentPayload }) =>
      leadsService.updateEnrollment(leadId as number, id, payload),
    onSuccess: () => {
      toast.success("Enrollment updated");
      void qc.invalidateQueries({ queryKey: ["lead"] });
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["enrollments"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not update enrollment")),
  });
}

export function useDeleteEnrollment(leadId?: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => leadsService.deleteEnrollment(leadId as number, id),
    onSuccess: () => {
      toast.success("Enrollment deleted");
      void qc.invalidateQueries({ queryKey: ["lead"] });
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["enrollments"] });
      void qc.invalidateQueries({ queryKey: ["payments"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not delete enrollment")),
  });
}

export function useAddPayment(leadId?: number, enrollmentId?: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ApiPaymentPayload) =>
      leadsService.addPayment(leadId as number, enrollmentId as number, payload),
    onSuccess: () => {
      toast.success("Payment recorded");
      void qc.invalidateQueries({ queryKey: ["lead"] });
      void qc.invalidateQueries({ queryKey: ["enrollments"] });
      void qc.invalidateQueries({ queryKey: ["payments"] });
      // A successful payment generates a receipt invoice server-side.
      void qc.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not record payment")),
  });
}

/**
 * Correct an existing payment. Marking a pending payment `successful` triggers
 * its receipt email, so invoices are invalidated alongside the billing caches.
 */
export function useUpdatePayment(leadId?: number, enrollmentId?: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: ApiPaymentPayload }) =>
      leadsService.updatePayment(leadId as number, enrollmentId as number, id, payload),
    onSuccess: () => {
      toast.success("Payment updated");
      void qc.invalidateQueries({ queryKey: ["lead"] });
      void qc.invalidateQueries({ queryKey: ["enrollments"] });
      void qc.invalidateQueries({ queryKey: ["payments"] });
      void qc.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not update payment")),
  });
}

export function useDeletePayment(leadId?: number, enrollmentId?: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      leadsService.deletePayment(leadId as number, enrollmentId as number, id),
    onSuccess: () => {
      toast.success("Payment deleted");
      void qc.invalidateQueries({ queryKey: ["lead"] });
      void qc.invalidateQueries({ queryKey: ["enrollments"] });
      void qc.invalidateQueries({ queryKey: ["payments"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not delete payment")),
  });
}

export function useArchiveLead() {
  const { isMock } = useDataSource();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, restore }: { id: number; restore?: boolean }) => {
      if (isMock) return { restore };
      await (restore ? leadsService.restore(id) : leadsService.archive(id));
      return { restore };
    },
    onSuccess: (r) => {
      if (isMock) {
        toast.success(r?.restore ? "Lead restored" : "Lead archived", {
          description: "Mock preview — not saved.",
        });
        return;
      }
      toast.success(r?.restore ? "Lead restored" : "Lead archived");
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["lead"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not update lead")),
  });
}
