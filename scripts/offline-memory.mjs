import os from "node:os";
import v8 from "node:v8";

const MB = 1024 * 1024;

export function offlineMemoryPlan(options = {}) {
  const totalMb = Math.floor(os.totalmem() / MB);
  const freeMb = Math.floor(os.freemem() / MB);
  const requestedMb = parseMemoryMb(options.requestedMb ?? process.env.COMFORMHEX_OFFLINE_MAX_OLD_SPACE_MB);
  const reserveMb = memoryReserveMb(totalMb);
  const autoMb = Math.max(2048, Math.floor(Math.min(totalMb * 0.75, totalMb - reserveMb)));
  const maxOldSpaceMb = requestedMb ?? autoMb;
  const currentHeapLimitMb = Math.floor(v8.getHeapStatistics().heap_size_limit / MB);
  const shouldRelaunch = currentHeapLimitMb < Math.floor(maxOldSpaceMb * 0.9);
  return {
    totalMb,
    freeMb,
    reserveMb,
    maxOldSpaceMb,
    currentHeapLimitMb,
    shouldRelaunch,
    source: requestedMb === undefined ? "auto" : "env"
  };
}

export function formatMemoryPlan(plan) {
  return [
    `system=${formatMb(plan.totalMb)}`,
    `free=${formatMb(plan.freeMb)}`,
    `reserve=${formatMb(plan.reserveMb)}`,
    `heap=${formatMb(plan.maxOldSpaceMb)}`,
    `currentHeap=${formatMb(plan.currentHeapLimitMb)}`,
    `source=${plan.source}`
  ].join(", ");
}

function memoryReserveMb(totalMb) {
  if (totalMb <= 8192) {
    return 2048;
  }
  if (totalMb <= 32768) {
    return 4096;
  }
  return 8192;
}

function parseMemoryMb(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const text = String(value).trim().toLowerCase();
  const match = text.match(/^(\d+(?:\.\d+)?)(mb|m|gb|g)?$/);
  if (!match) {
    throw new Error(`invalid COMFORMHEX_OFFLINE_MAX_OLD_SPACE_MB value: ${value}`);
  }
  const amount = Number(match[1]);
  const unit = match[2] ?? "mb";
  const mb = unit === "gb" || unit === "g" ? amount * 1024 : amount;
  if (!Number.isFinite(mb) || mb < 512) {
    throw new Error(`invalid COMFORMHEX_OFFLINE_MAX_OLD_SPACE_MB value: ${value}`);
  }
  return Math.floor(mb);
}

function formatMb(value) {
  return value >= 1024 ? `${(value / 1024).toFixed(1)}GB` : `${value}MB`;
}
