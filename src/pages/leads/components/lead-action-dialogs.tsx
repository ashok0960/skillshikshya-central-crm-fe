import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/context/auth";
import { useDataSource } from "@/context/data-source";
import { CALL_OUTCOMES, COUNSELORS, counselorName } from "@/data/lead-lookups";
import { parseCallDuration, describeCallDuration } from "@/lib/call-duration";
import { apiErrorMessage } from "@/lib/api";
import { formatDateToNepalIso, toNepalIso } from "@/lib/leads-format";
import { useAddCall, useAddFollowup, useAssignLead } from "@/hooks/use-leads";
import { useCounselors } from "@/hooks/use-users";

export type LeadAction = "log_call" | "follow_up" | "assign" | null;

/** Minimal shape the dialogs need — satisfied by both Lead and LeadListItem. */
export interface LeadActionTarget {
  fullName: string;
  assignedTo: string | null;
  assignedToName?: string;
  /** Numeric backend id — required to persist actions on the live path. */
  apiId?: number;
  primaryPhone?: string;
}

interface Props {
  action: LeadAction;
  lead: LeadActionTarget | null;
  onClose: () => void;
}

interface CallForm {
  direction: "outbound" | "inbound";
  outcome: string;
  duration: string;
  recording: string;
  notes: string;
  nextFollowUp: string;
  nextAction: string;
}

const EMPTY_CALL: CallForm = {
  direction: "outbound",
  outcome: "interested",
  duration: "",
  recording: "",
  notes: "",
  nextFollowUp: "",
  nextAction: "",
};

interface FollowUpForm {
  scheduledAt: string;
  assignedTo: string;
  purpose: string;
  reminder: "30m" | "1h" | "1d";
}

const EMPTY_FU: FollowUpForm = { scheduledAt: "", assignedTo: "", purpose: "", reminder: "1h" };

const REMINDER_OFFSETS_MS: Record<FollowUpForm["reminder"], number> = {
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

/**
 * All lead quick-actions live here. This is the static phase: the forms are
 * laid out with the fields the real workflow needs, but Save only shows a
 * toast — no mutation is performed.
 */
export function LeadActionDialogs({ action, lead, onClose }: Props) {
  const name = lead?.fullName ?? "lead";
  const { isMock } = useDataSource();
  const { user } = useAuth();
  const addCall = useAddCall(lead?.apiId);
  const addFollowup = useAddFollowup(lead?.apiId);
  const assignLead = useAssignLead();
  const counselorsQ = useCounselors("", undefined, !isMock);
  const [call, setCall] = useState<CallForm>(EMPTY_CALL);
  const [durationError, setDurationError] = useState("");
  const [fu, setFu] = useState<FollowUpForm>(EMPTY_FU);
  const [assignTo, setAssignTo] = useState("");

  // Pre-select the current owner when the Assign dialog opens.
  useEffect(() => {
    if (action === "assign") setAssignTo(lead?.assignedTo ?? "");
  }, [action, lead?.assignedTo]);
  const setC = <K extends keyof CallForm>(k: K, v: CallForm[K]) =>
    setCall((c) => ({ ...c, [k]: v }));
  const setF = <K extends keyof FollowUpForm>(k: K, v: FollowUpForm[K]) =>
    setFu((f) => ({ ...f, [k]: v }));

  // Real counselors (Counselor role) on the live path; mock list otherwise.
  const counselorOptions = isMock
    ? COUNSELORS.map((c) => ({ value: c.id, label: c.name }))
    : (counselorsQ.data?.results ?? []).map((u) => ({ value: String(u.id), label: u.name }));
  // Default the follow-up owner to the lead's counsellor, else the current user.
  const fuAssigned = fu.assignedTo || lead?.assignedTo || (user?.id != null ? String(user.id) : "");

  function done(message: string) {
    toast.success(message, { description: "Static prototype — no data was changed." });
    onClose();
  }

  function submitCall() {
    const durationInput = call.duration.trim();
    if (durationInput && parseCallDuration(durationInput) === null) {
      setDurationError("Enter a valid duration, such as 4:19, 4.19, 4m19s, or 259.");
      return;
    }
    setDurationError("");

    // Mock path (or a lead with no backend id) can't persist — keep the toast.
    if (isMock || lead?.apiId == null) {
      done("Call logged");
      setCall(EMPTY_CALL);
      return;
    }
    addCall.mutate(
      {
        call_timestamp: new Date().toISOString(),
        caller: user?.name ?? "Unknown",
        direction: call.direction,
        outcome: call.outcome || null,
        duration_input: durationInput || undefined,
        recording_url: call.recording.trim() || null,
        notes: call.notes.trim() || null,
        next_followup_at: call.nextFollowUp ? toNepalIso(call.nextFollowUp) : null,
        next_action: call.nextAction.trim() || null,
        phone_number: lead?.primaryPhone ?? null,
      },
      {
        onSuccess: () => {
          setCall(EMPTY_CALL);
          onClose();
        },
        onError: (error) => setDurationError(apiErrorMessage(error, "Could not log call")),
      },
    );
  }

  function submitFollowUp() {
    if (isMock || lead?.apiId == null) {
      done("Follow-up scheduled");
      setFu(EMPTY_FU);
      return;
    }
    if (!fu.scheduledAt) {
      toast.error("Pick a date & time for the follow-up.");
      return;
    }
    const scheduledDate = new Date(fu.scheduledAt);
    addFollowup.mutate(
      {
        scheduled_at: toNepalIso(fu.scheduledAt),
        assigned_to: fuAssigned ? Number(fuAssigned) : null,
        purpose: fu.purpose.trim() || null,
        reminder_at: formatDateToNepalIso(new Date(scheduledDate.getTime() - REMINDER_OFFSETS_MS[fu.reminder])),
        status: "pending",
      },
      {
        onSuccess: () => {
          setFu(EMPTY_FU);
          onClose();
        },
      },
    );
  }

  return (
    <>
      {/* Log Call */}
      <Dialog open={action === "log_call"} onOpenChange={(o) => !o && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log a call — {name}</DialogTitle>
            <DialogDescription>Record the outcome of this call on the lead timeline.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Direction</Label>
                <Select value={call.direction} onValueChange={(v) => setC("direction", v as CallForm["direction"])}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="outbound">Outbound</SelectItem>
                    <SelectItem value="inbound">Inbound</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Outcome</Label>
                <Select value={call.outcome} onValueChange={(v) => setC("outcome", v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select outcome" />
                  </SelectTrigger>
                  <SelectContent>
                    {CALL_OUTCOMES.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="call-duration">Duration</Label>
                <Input
                  id="call-duration"
                  type="text"
                  inputMode="text"
                  placeholder="MM:SS, e.g. 4:19"
                  value={call.duration}
                  aria-invalid={Boolean(durationError)}
                  aria-describedby={durationError ? "call-duration-error" : "call-duration-preview"}
                  onChange={(e) => {
                    setC("duration", e.target.value);
                    setDurationError("");
                  }}
                />
                <p className="text-muted-foreground text-xs">MM:SS, e.g. 4:19</p>
                {call.duration.trim() && parseCallDuration(call.duration) !== null && (
                  <p id="call-duration-preview" className="text-muted-foreground text-xs">
                    {describeCallDuration(parseCallDuration(call.duration) ?? 0)}
                  </p>
                )}
                {durationError && (
                  <p id="call-duration-error" className="text-destructive text-xs" role="alert">
                    {durationError}
                  </p>
                )}
              </div>
              <div className="grid gap-2">
                <Label>Recording link</Label>
                <Input
                  placeholder="Optional URL"
                  value={call.recording}
                  onChange={(e) => setC("recording", e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Notes</Label>
              <Textarea
                rows={3}
                placeholder="What did the caller say?"
                value={call.notes}
                onChange={(e) => setC("notes", e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Next follow-up</Label>
                <Input
                  type="datetime-local"
                  value={call.nextFollowUp}
                  onChange={(e) => setC("nextFollowUp", e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label>Next action</Label>
                <Input
                  placeholder="e.g. Send fee plan on WhatsApp"
                  value={call.nextAction}
                  onChange={(e) => setC("nextAction", e.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={addCall.isPending}>
              Cancel
            </Button>
            <Button variant="brand" onClick={submitCall} disabled={addCall.isPending}>
              {addCall.isPending ? "Logging…" : "Log Call"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Follow-up */}
      <Dialog open={action === "follow_up"} onOpenChange={(o) => !o && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule follow-up — {name}</DialogTitle>
            <DialogDescription>Set the next touchpoint and its purpose.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Date &amp; time</Label>
                <Input
                  type="datetime-local"
                  value={fu.scheduledAt}
                  onChange={(e) => setF("scheduledAt", e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label>Assigned to</Label>
                <Select value={fuAssigned} onValueChange={(v) => setF("assignedTo", v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select counselor" />
                  </SelectTrigger>
                  <SelectContent>
                    {counselorOptions.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Purpose</Label>
              <Textarea
                rows={3}
                placeholder="e.g. Confirm preferred batch and share fee structure"
                value={fu.purpose}
                onChange={(e) => setF("purpose", e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>Reminder</Label>
              <Select value={fu.reminder} onValueChange={(v) => setF("reminder", v as FollowUpForm["reminder"])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30m">30 minutes before</SelectItem>
                  <SelectItem value="1h">1 hour before</SelectItem>
                  <SelectItem value="1d">1 day before</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={addFollowup.isPending}>
              Cancel
            </Button>
            <Button variant="brand" onClick={submitFollowUp} disabled={addFollowup.isPending}>
              {addFollowup.isPending ? "Scheduling…" : "Schedule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign */}
      <Dialog open={action === "assign"} onOpenChange={(o) => !o && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign lead — {name}</DialogTitle>
            <DialogDescription>
              Currently{" "}
              {lead?.assignedTo
                ? `assigned to ${lead.assignedToName ?? counselorName(lead.assignedTo)}`
                : "in the unassigned pool"}
              .
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Counselor</Label>
              <Select value={assignTo || undefined} onValueChange={setAssignTo}>
                <SelectTrigger>
                  <SelectValue placeholder={counselorsQ.isFetching ? "Loading counselors…" : "Select counselor"} />
                </SelectTrigger>
                <SelectContent>
                  {counselorOptions.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Reason (optional)</Label>
              <Input placeholder="e.g. Rebalancing workload" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={assignLead.isPending}>
              Cancel
            </Button>
            <Button
              variant="brand"
              disabled={assignLead.isPending}
              onClick={() => {
                if (isMock || lead?.apiId == null) {
                  done("Lead reassigned");
                  return;
                }
                if (!assignTo) {
                  toast.error("Select a counselor.");
                  return;
                }
                assignLead.mutate(
                  { id: lead.apiId, counselorId: Number(assignTo) },
                  { onSuccess: () => onClose() },
                );
              }}
            >
              {assignLead.isPending ? "Assigning…" : "Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
