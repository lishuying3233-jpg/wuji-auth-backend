import { createHeartbeatJob, listHeartbeatJobs, updateHeartbeatJob } from "./server/_core/heartbeat.ts";
import { ENV } from "./server/_core/env.ts";

async function main() {
  console.log("Checking for existing verifyOrders job...");
  try {
    const { jobs } = await listHeartbeatJobs("");
    const existing = jobs.find(j => j.name === "verifyOrders");

    if (existing) {
      console.log(`Found existing job ${existing.taskUid}, updating...`);
      await updateHeartbeatJob(existing.taskUid, {
        cron: "0 */2 * * * *", // 每 2 分钟执行一次
        path: "/api/scheduled/verifyOrders",
        enable: true
      }, "");
      console.log("Job updated successfully.");
    } else {
      console.log("Creating new verifyOrders job...");
      const result = await createHeartbeatJob({
        name: "verifyOrders",
        cron: "0 */2 * * * *", // 每 2 分钟执行一次
        path: "/api/scheduled/verifyOrders",
        method: "POST",
        description: "USDT 订单链上核验与自动发码"
      }, "");
      console.log(`Job created successfully: ${result.taskUid}`);
    }
  } catch (e) {
    console.error("Failed to register heartbeat job:", e.message);
    process.exit(1);
  }
}

main();
