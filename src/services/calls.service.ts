import { api } from "@/lib/api";
import type { CallFilters, CallListParams, CallPage, CallSummary } from "@/types/calls";

export const callsService = {
  async list(params: CallListParams) {
    const { data } = await api.get<CallPage>("/calls/", { params });
    return data;
  },

  async summary(params: CallFilters) {
    const { data } = await api.get<CallSummary>("/calls/summary/", { params });
    return data;
  },

  async exportCsv(params: CallFilters) {
    const { data } = await api.get<Blob>("/calls/export/", {
      params,
      responseType: "blob",
    });
    const url = URL.createObjectURL(data);
    const link = document.createElement("a");
    const dateParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kathmandu",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const get = (type: string) => dateParts.find((part) => part.type === type)?.value ?? "";
    link.href = url;
    link.download = `calls-${get("year")}-${get("month")}-${get("day")}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  },
};
