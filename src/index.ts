import { QueueManager } from './queueManager';
import { WebSrvManager } from './webserverHandle';
import { captureException } from '@sentry/node';
import { DatabaseManager } from './DatabaseManager';

const pgClient = new DatabaseManager(process.env["PGSQL_CONN"] ?? "");
const queueMGR = new QueueManager(pgClient);
const webSrvMGR = new WebSrvManager(pgClient, queueMGR);


if(!process.env["SMTP_CONN"] || !process.env["AMQP_CONN"])
  throw Error("Queue Manager Cannot Be Initialize: Missing SMTP_CONN or AMQP_CONN env variable");

queueMGR.setup(process.env["SMTP_CONN"], process.env["AMQP_CONN"]);
webSrvMGR.setup(process.env["PORT"] ? parseInt(process.env["PORT"]) : 3000);