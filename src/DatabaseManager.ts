import { captureException, cron, logger } from "@sentry/node";
import { Pool, type QueryResult, type QueryResultRow } from "pg";
import nCron from "node-cron";
import type { requestsTable } from "./Types";

export class DatabaseManager {
  private _pgPool: Pool;
  private _isConnected: boolean;
  constructor(PgConnStr: string) {
    this._isConnected = false;
    this._pgPool = new Pool({
      connectionString: PgConnStr,
      max: 5,
      idleTimeoutMillis: 90000, // 1.5 minutes
      connectionTimeoutMillis: 10000, // 10 seconds
    });

    // Internal Connection Health Check
    this.healthCheck();
    const mainCron = cron.instrumentNodeCron(nCron);
    mainCron.schedule("* * * * *", this.healthCheck.bind(this), { name: "db-health-check" });
    mainCron.schedule("0 0 * * *", this.cleanOldJob.bind(this), { name: "clean-old-jobs" });
  }

  get pgPool() {
    return this._pgPool;
  }

  get isConnected() {
    return this._isConnected;
  }

  // Timeout handled query
  async query<T extends QueryResultRow>(query: string, param?: unknown[]): Promise<QueryResult<T> | undefined> {
    try {
      const res = await this._pgPool.query<T>(query, param);
      this._isConnected = true;
      return res;
    } catch(ex) {
      if(ex instanceof Error && ex.message.includes("ETIMEDOUT")) {
        this._isConnected = false;
        return;
      }
      throw ex;
    }
  }

  // Handler to (cron) clean-up job
  private async cleanOldJob() {
    const qRes = await this._pgPool.query<requestsTable>("DELETE FROM requests WHERE fulfilled < now() - interval '1 month'");
    if(!qRes)
      return logger.warn("Fail to clean up old job due to database downtime");

    logger.info("Cleaned up %d requests (at least 1 month old)", [qRes.rowCount ? qRes.rowCount : -1]);
  }

  // Perodic DB Health Check
  private async healthCheck() {
    try {
      await this._pgPool.query("SELECT 1");
      this._isConnected = true;
    } catch(ex) {
      if(ex instanceof Error && ex.message.includes("ETIMEDOUT")) {
        this._isConnected = false;
        return;
      }
      captureException(ex);
    }
  }

}