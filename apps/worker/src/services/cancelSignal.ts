import { workerRedis } from "./chatQueue.js";

export function cancelKey(jobId: string): string {
  return `cancel:job:${jobId}`;
}

export async function isJobCancelled(jobId: string): Promise<boolean> {
  return (await workerRedis.get(cancelKey(jobId))) === "1";
}

export async function throwIfCancelled(jobId: string): Promise<void> {
  if (await isJobCancelled(jobId)) {
    throw new Error("JOB_CANCELLED");
  }
}
