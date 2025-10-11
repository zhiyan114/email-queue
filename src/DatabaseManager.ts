import { Pool, type QueryResult, type QueryResultRow } from "pg";
import { setTimeout } from "timers/promises";

export class DatabaseManager {
  private _pgPool: Pool;
  constructor(PgConnStr: string) {
    this._pgPool = new Pool({
      connectionString: PgConnStr,
      max: 5,
      idleTimeoutMillis: 60000,
      connectionTimeoutMillis: 10000,
    });
  }

  get pgPool() {
    return this._pgPool;
  }

  // Timeout handled query
  async query<T extends QueryResultRow>(query: string, param?: unknown[]): Promise<QueryResult<T>> {
    try {
      return await this._pgPool.query<T>(query, param);
    } catch(ex) {
      if(ex instanceof Error && ex.message.includes("ETIMEDOUT")) {
        await setTimeout(1000); // wait for connection a bit
        return await this.query<T>(query, param);
      }
      throw ex;
    }
  }

}