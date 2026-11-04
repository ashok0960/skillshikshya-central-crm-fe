import type { Paginated } from "@/types";

export interface CallRecord {
  id: number;
  lead: number;
  lead_name: string;
  lead_reference_number: string | null;
  call_timestamp: string;
  direction: "inbound" | "outbound";
  caller: string | null;
  phone_number: string | null;
  duration_seconds: number;
  duration_formatted: string;
  outcome: string | null;
  notes: string | null;
  recording_url: string | null;
  next_followup_at: string | null;
  next_action: string | null;
  branch: number | null;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
}

export interface CallFilters {
  search?: string;
  direction?: "inbound" | "outbound";
  created_by?: number;
  branch_id?: number;
  call_timestamp__gte?: string;
  call_timestamp__lte?: string;
}

export interface CallListParams extends CallFilters {
  page: number;
  page_size: number;
  ordering: string;
}

export interface CallSummary {
  total_calls: number;
  inbound: number;
  outbound: number;
  total_seconds: number;
  total_formatted: string;
  avg_seconds: number;
  connected_calls: number;
  connect_rate: number;
  by_day: { date: string; calls: number; seconds: number }[];
  by_user: { user_id: number | null; name: string; calls: number; seconds: number }[];
}

export type CallPage = Paginated<CallRecord>;
