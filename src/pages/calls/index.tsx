import { ArrowDown, ArrowUp, Download, LoaderCircle, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { HBarList, MiniBars } from "@/components/charts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/context/auth";
import { useBranches } from "@/hooks/use-branches";
import { useCallSummary, useCalls } from "@/hooks/use-calls";
import { useUsers } from "@/hooks/use-users";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { apiErrorMessage } from "@/lib/api";
import { formatCallDuration } from "@/lib/call-duration";
import { callsService } from "@/services/calls.service";
import type { CallFilters, CallRecord } from "@/types/calls";
import { toast } from "sonner";

const PAGE_SIZE = 20;
const NEPAL_TIME_ZONE = "Asia/Kathmandu";

type DatePreset = "today" | "last7" | "month" | "custom";

function nepalDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NEPAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function shiftDate(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function dateBound(date: string, endOfDay: boolean): string | undefined {
  if (!date) return undefined;
  return `${date}T${endOfDay ? "23:59:59.999999" : "00:00:00"}+05:45`;
}

function formatCallDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: NEPAL_TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

function formatLongCallDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: NEPAL_TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

function CallField({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="text-sm break-words">{value || "—"}</p>
    </div>
  );
}

function CallDetailSheet({
  call,
  onClose,
}: {
  call: CallRecord | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={call !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Call details</SheetTitle>
          <SheetDescription>
            {call ? `${call.lead_name || "Call"} · ${call.lead_reference_number || "—"}` : "Call record"}
          </SheetDescription>
        </SheetHeader>
        {call && (
          <SheetBody>
            <div className="grid gap-5 sm:grid-cols-2">
              <CallField label="Date & time" value={formatLongCallDate(call.call_timestamp)} />
              <CallField label="Direction" value={call.direction} />
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs">Lead</p>
                {call.lead ? (
                  <Link className="text-brand text-sm font-medium underline-offset-4 hover:underline" to={`/leads/${call.lead}`}>
                    {call.lead_name || "—"}
                  </Link>
                ) : (
                  <p className="text-sm">—</p>
                )}
              </div>
              <CallField label="Phone" value={call.phone_number} />
              <CallField label="Caller" value={call.caller} />
              <CallField label="Logged by" value={call.created_by_name} />
              <CallField
                label="Duration"
                value={call.duration_formatted || formatCallDuration(call.duration_seconds)}
              />
              <CallField label="Outcome" value={call.outcome} />
              <CallField label="Next follow-up" value={call.next_followup_at ? formatLongCallDate(call.next_followup_at) : null} />
              <CallField label="Next action" value={call.next_action} />
              <div className="space-y-1 sm:col-span-2">
                <p className="text-muted-foreground text-xs">Notes</p>
                <p className="text-sm whitespace-pre-wrap break-words">{call.notes || "—"}</p>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <p className="text-muted-foreground text-xs">Recording</p>
                {call.recording_url ? (
                  <a
                    className="text-brand text-sm font-medium underline-offset-4 hover:underline"
                    href={call.recording_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open recording
                  </a>
                ) : (
                  <p className="text-sm">—</p>
                )}
              </div>
            </div>
          </SheetBody>
        )}
      </SheetContent>
    </Sheet>
  );
}

function SummaryCard({
  label,
  value,
  detail,
  loading,
}: {
  label: string;
  value: string | number;
  detail?: string;
  loading: boolean;
}) {
  return (
    <Card className="gap-2 py-5">
      <CardHeader>
        <CardDescription className="font-mono text-[11px] font-medium tracking-wider uppercase">
          {label}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <>
            <p className="font-headline text-2xl font-semibold tabular-nums">{value}</p>
            {detail && <p className="text-muted-foreground mt-1 text-xs">{detail}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function CallsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const isStaff = !!(user?.is_staff || user?.is_superuser);
  const [searchInput, setSearchInput] = useState(searchParams.get("search") ?? "");
  const [selectedCall, setSelectedCall] = useState<CallRecord | null>(null);
  const [exporting, setExporting] = useState(false);
  const debouncedSearch = useDebouncedValue(searchInput, 300);
  const urlSearch = searchParams.get("search") ?? "";
  useEffect(() => {
    setSearchInput(urlSearch);
  }, [urlSearch]);

  const updateParams = useCallback(
    (updates: Record<string, string | null>, resetPage = true) => {
      const next = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(updates)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      if (resetPage) next.delete("page");
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  useEffect(() => {
    if (debouncedSearch.trim() !== urlSearch) {
      updateParams({ search: debouncedSearch.trim() || null });
    }
  }, [debouncedSearch, urlSearch, updateParams]);

  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const directionValue = searchParams.get("direction");
  const direction =
    directionValue === "inbound" || directionValue === "outbound" ? directionValue : "all";
  const createdBy = searchParams.get("created_by") ?? "";
  const branchId = searchParams.get("branch_id") ?? "";
  const dateFrom = searchParams.get("from") ?? "";
  const dateTo = searchParams.get("to") ?? "";
  const preset = (searchParams.get("preset") as DatePreset | null) ?? "all";
  const ordering = searchParams.get("ordering") ?? "-call_timestamp";

  const filters = useMemo<CallFilters>(() => {
    const result: CallFilters = {};
    if (urlSearch.trim()) result.search = urlSearch.trim();
    if (direction !== "all") result.direction = direction;
    if (createdBy) result.created_by = Number(createdBy);
    if (isStaff && branchId) result.branch_id = Number(branchId);
    if (dateFrom) result.call_timestamp__gte = dateBound(dateFrom, false);
    if (dateTo) result.call_timestamp__lte = dateBound(dateTo, true);
    return result;
  }, [urlSearch, direction, createdBy, branchId, dateFrom, dateTo, isStaff]);

  const listParams = useMemo(
    () => ({ ...filters, page, page_size: PAGE_SIZE, ordering }),
    [filters, page, ordering],
  );
  const callsQuery = useCalls(listParams);
  const summaryQuery = useCallSummary(filters);
  const usersQuery = useUsers(1, 100, "");
  const branchesQuery = useBranches(1, 100, "", isStaff);
  const calls = callsQuery.data?.results ?? [];
  const count = callsQuery.data?.count ?? 0;
  const summary = summaryQuery.data;
  const hasFilters = Boolean(
    urlSearch.trim() || direction !== "all" || createdBy || branchId || dateFrom || dateTo,
  );
  const hasError = callsQuery.isError || summaryQuery.isError;

  function applyDatePreset(value: string) {
    const today = nepalDate();
    let from: string | null = null;
    let to: string | null = null;
    if (value === "today") {
      from = today;
      to = today;
    } else if (value === "last7") {
      from = shiftDate(today, -6);
      to = today;
    } else if (value === "month") {
      from = `${today.slice(0, 7)}-01`;
      to = today;
    }
    updateParams({ preset: value, from, to });
  }

  function setSort(field: "call_timestamp" | "duration_seconds") {
    const next = ordering === `-${field}` ? field : `-${field}`;
    updateParams({ ordering: next });
  }

  function sortButton(field: "call_timestamp" | "duration_seconds", label: string) {
    const active = ordering === field || ordering === `-${field}`;
    const descending = ordering === `-${field}`;
    return (
      <Button
        className="-ml-3 h-8 px-3"
        variant="ghost"
        onClick={() => setSort(field)}
        aria-label={`Sort by ${label}`}
      >
        {label}
        {active && (descending ? <ArrowDown className="ml-1 size-3.5" /> : <ArrowUp className="ml-1 size-3.5" />)}
      </Button>
    );
  }

  async function exportCalls() {
    setExporting(true);
    try {
      await callsService.exportCsv(filters);
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not export calls"));
    } finally {
      setExporting(false);
    }
  }

  const dailyRows = summary?.by_day.slice(-7) ?? [];
  const pages = Math.ceil(count / PAGE_SIZE);
  const firstShown = count === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastShown = count === 0 ? 0 : firstShown + calls.length - 1;

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-brand font-mono text-[11px] font-bold tracking-wider uppercase">CRM Workspace</p>
          <h1 className="font-headline mt-1 text-3xl font-semibold tracking-tight">Calls</h1>
          <p className="text-muted-foreground mt-1 text-sm">Team call activity across leads.</p>
        </div>
        <Button variant="outline" onClick={exportCalls} disabled={exporting}>
          {exporting ? <LoaderCircle className="animate-spin" /> : <Download />}
          {exporting ? "Preparing CSV…" : "Export CSV"}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Total calls"
          value={summary?.total_calls ?? 0}
          detail={`${summary?.inbound ?? 0} inbound · ${summary?.outbound ?? 0} outbound`}
          loading={summaryQuery.isLoading}
        />
        <SummaryCard
          label="Talk time"
          value={summary?.total_formatted ?? "00:00"}
          detail="Total recorded call duration"
          loading={summaryQuery.isLoading}
        />
        <SummaryCard
          label="Average duration"
          value={formatCallDuration(summary?.avg_seconds ?? 0)}
          detail="Across all calls in this view"
          loading={summaryQuery.isLoading}
        />
        <SummaryCard
          label="Connect rate"
          value={`${((summary?.connect_rate ?? 0) * 100).toFixed(1)}%`}
          detail={`${summary?.connected_calls ?? 0} calls over 0 seconds`}
          loading={summaryQuery.isLoading}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Calls per day</CardTitle>
            <CardDescription>Daily call volume in Nepal time</CardDescription>
          </CardHeader>
          <CardContent>
            {summaryQuery.isLoading ? (
              <Skeleton className="h-28 w-full" />
            ) : dailyRows.length ? (
              <>
                <MiniBars values={dailyRows.map((row) => row.calls)} />
                <div className="mt-2 grid grid-cols-7 gap-1 text-center font-mono text-[10px] text-muted-foreground">
                  {dailyRows.map((row) => (
                    <span key={row.date}>{row.date.slice(5)}</span>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-muted-foreground flex h-28 items-center justify-center text-sm">
                No call activity for these filters.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top callers</CardTitle>
            <CardDescription>Top 10 by calls logged</CardDescription>
          </CardHeader>
          <CardContent>
            {summaryQuery.isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : summary?.by_user.length ? (
              <HBarList data={summary.by_user.map((row) => ({ label: row.name, value: row.calls }))} />
            ) : (
              <p className="text-muted-foreground flex h-28 items-center justify-center text-sm">
                No callers for these filters.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="relative min-w-[min(100%,15rem)] flex-1 sm:max-w-sm">
            <Search className="text-muted-foreground absolute top-2.5 left-3 size-4" />
            <Input
              aria-label="Search calls"
              placeholder="Search lead, phone, caller, or notes"
              className="rounded-full pl-9"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </div>
          <Select
            value={direction}
            onValueChange={(value) => updateParams({ direction: value === "all" ? null : value })}
          >
            <SelectTrigger className="w-full sm:w-36"><SelectValue placeholder="Direction" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All directions</SelectItem>
              <SelectItem value="inbound">Inbound</SelectItem>
              <SelectItem value="outbound">Outbound</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={createdBy || "all"}
            onValueChange={(value) => updateParams({ created_by: value === "all" ? null : value })}
          >
            <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="Logged by" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Anyone</SelectItem>
              {(usersQuery.data?.results ?? []).map((person) => (
                <SelectItem key={person.id} value={String(person.id)}>{person.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isStaff && (
            <Select
              value={branchId || "all"}
              onValueChange={(value) => updateParams({ branch_id: value === "all" ? null : value })}
            >
              <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder="Branch" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All branches</SelectItem>
                {(branchesQuery.data?.results ?? []).map((branch) => (
                  <SelectItem key={branch.id} value={String(branch.id)}>{branch.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={preset} onValueChange={applyDatePreset}>
            <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder="Date range" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All dates</SelectItem>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="last7">Last 7 days</SelectItem>
              <SelectItem value="month">This month</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
          {preset === "custom" && (
            <div className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
              <div className="grid gap-1">
                <Label className="text-xs" htmlFor="calls-from">From</Label>
                <Input
                  id="calls-from"
                  className="w-full sm:w-36"
                  type="date"
                  value={dateFrom}
                  onChange={(event) => updateParams({ preset: "custom", from: event.target.value || null })}
                />
              </div>
              <div className="grid gap-1">
                <Label className="text-xs" htmlFor="calls-to">To</Label>
                <Input
                  id="calls-to"
                  className="w-full sm:w-36"
                  type="date"
                  value={dateTo}
                  onChange={(event) => updateParams({ preset: "custom", to: event.target.value || null })}
                />
              </div>
            </div>
          )}
          <Button
            variant="ghost"
            className="ml-auto"
            disabled={!hasFilters}
            onClick={() => {
              setSearchInput("");
              setSearchParams(new URLSearchParams());
            }}
          >
            Clear filters
          </Button>
        </div>

        {hasError && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3">
            <p className="text-sm text-destructive">
              {apiErrorMessage(callsQuery.error ?? summaryQuery.error, "Could not load calls.")}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void callsQuery.refetch();
                void summaryQuery.refetch();
              }}
            >
              Retry
            </Button>
          </div>
        )}

        <div className="bg-card min-w-0 overflow-hidden rounded-2xl border shadow-[0_1px_3px_0_rgba(0,0,0,0.05),0_1px_2px_-1px_rgba(0,0,0,0.05)]">
          <div className="overflow-x-auto">
            <Table className="min-w-[1050px]">
              <TableHeader>
                <TableRow>
                  <TableHead>{sortButton("call_timestamp", "When")}</TableHead>
                  <TableHead>Direction</TableHead>
                  <TableHead>Lead (name + reference)</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Logged by</TableHead>
                  <TableHead>{sortButton("duration_seconds", "Duration (MM:SS)")}</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>Recording</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {callsQuery.isLoading &&
                  Array.from({ length: 5 }).map((_, index) => (
                    <TableRow key={index}>
                      <TableCell colSpan={8}><Skeleton className="h-6 w-full" /></TableCell>
                    </TableRow>
                  ))}
                {!callsQuery.isLoading && !callsQuery.isError && calls.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-muted-foreground py-14 text-center">
                      {hasFilters ? "No calls match these filters." : "No calls yet."}
                    </TableCell>
                  </TableRow>
                )}
                {!callsQuery.isLoading && callsQuery.isError && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-muted-foreground py-10 text-center">
                      Calls could not be loaded.
                    </TableCell>
                  </TableRow>
                )}
                {calls.map((call) => (
                  <TableRow
                    key={call.id}
                    className="cursor-pointer"
                    tabIndex={0}
                    onClick={() => setSelectedCall(call)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedCall(call);
                      }
                    }}
                  >
                    <TableCell className="whitespace-nowrap">{formatCallDate(call.call_timestamp)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="capitalize">{call.direction}</Badge>
                    </TableCell>
                    <TableCell>
                      <Link
                        to={`/leads/${call.lead}`}
                        className="font-semibold underline-offset-4 hover:underline"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {call.lead_name || "—"}
                      </Link>
                      <p className="text-muted-foreground font-mono text-xs">{call.lead_reference_number || "—"}</p>
                    </TableCell>
                    <TableCell>{call.phone_number || "—"}</TableCell>
                    <TableCell>{call.created_by_name || "—"}</TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {call.duration_formatted || formatCallDuration(call.duration_seconds)}
                    </TableCell>
                    <TableCell>{call.outcome || "—"}</TableCell>
                    <TableCell>
                      {call.recording_url ? (
                        <a
                          className="text-brand underline-offset-4 hover:underline"
                          href={call.recording_url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => event.stopPropagation()}
                        >
                          Recording
                        </a>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
            <p className="text-muted-foreground text-sm">
              Showing {firstShown}–{lastShown} of {count}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || callsQuery.isFetching}
                onClick={() => updateParams({ page: String(page - 1) }, false)}
              >
                Previous
              </Button>
              <span className="text-muted-foreground text-xs tabular-nums">{page} / {Math.max(1, pages)}</span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pages || callsQuery.isFetching}
                onClick={() => updateParams({ page: String(page + 1) }, false)}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      </section>

      <CallDetailSheet call={selectedCall} onClose={() => setSelectedCall(null)} />
    </div>
  );
}
