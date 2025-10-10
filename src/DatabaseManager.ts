import { captureEvent, logger } from "@sentry/node";
import { Client } from "pg";
import { setTimeout } from "timers/promises";

export class DatabaseManager {
  private _pgClient: Client;
  private _isConnected: boolean;
  constructor(PgConnStr: string) {
    this._pgClient = new Client(PgConnStr);
    this._isConnected = false;

    this._pgClient.on("error", this.errorHandle.bind(this));
  }

  async login() {
    await this.connectMGR();
  }

  get pgClient() {
    return this._pgClient;
  }

  get isConnected() {
    return this._isConnected;
  }

  private async errorHandle(err: Error) {
    logger.error("Database thrownen an error! Endpoints are now inaccessible. Reconnect every 15 seconds!");
    captureEvent(err);
    this._isConnected = false;
    await this.connectMGR();
  }

  private async connectMGR() {
    while(true) {
      logger.info("Attempting PGSQL Connection...");
      try {
        await this._pgClient.connect();
        this._isConnected = true;
        logger.info("PGSQL Connection Success...");
        break;
      } catch {
        await new Promise<void>((res) => setTimeout(15000, res()));
      }
    }
  }

}