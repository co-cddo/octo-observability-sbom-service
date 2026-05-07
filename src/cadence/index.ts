import { Pool } from "pg";
import PgBoss from "pg-boss";
import { updateReleaseCadenceIndicator, getServiceById } from "../db/queries";

interface CadenceJobData {
  serviceId: string;
}

export function registerCadenceHandler(boss: PgBoss, pool: Pool): void {
  boss.work<CadenceJobData>(
    "update-cadence",
    { batchSize: 1 },
    async (jobs) => {
      if (jobs.length !== 1)
        throw new Error(`Expected 1 job, got ${jobs.length}`);
      const { serviceId } = jobs[0].data;
      await updateReleaseCadenceIndicator(pool, serviceId);
      const service = await getServiceById(pool, serviceId);
      console.log(`Updated release cadence for ${serviceId}`);
      return `${service?.name || serviceId} - cadence updated`;
    },
  );
}
