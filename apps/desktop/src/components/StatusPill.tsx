import type { RunStatus } from "../types";

const STATUS_META: Record<RunStatus, { label: string; tone: string }> = {
  pending: { label: "Queued", tone: "blue" },
  running: { label: "Working", tone: "blue" },
  waiting_for_info: { label: "Needs information", tone: "amber" },
  waiting_approval: { label: "Awaiting approval", tone: "amber" },
  suspended_budget: { label: "Budget suspended", tone: "red" },
  failed: { label: "Failed", tone: "red" },
  completed: { label: "Completed", tone: "green" },
  cancelled: { label: "Cancelled", tone: "gray" },
};

export function StatusPill({ status }: { status: RunStatus }) {
  const meta = STATUS_META[status] ?? { label: status, tone: "gray" };
  return <span className={`pill ${meta.tone}`}>{meta.label}</span>;
}

export function approvalTone(status: "pending" | "approved" | "rejected"): string {
  return status === "pending" ? "amber" : status === "approved" ? "green" : "red";
}
