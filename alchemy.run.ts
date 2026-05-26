import alchemy from "alchemy";
import { Ai, D1Database, DurableObjectNamespace, SvelteKit, Worker } from "alchemy/cloudflare";
import { CloudflareStateStore } from "alchemy/state";
import type { LoopDO } from "./worker/LoopDO.ts";

const projectName = "loop";
const app = await alchemy(projectName, {
  password: process.env.ALCHEMY_PASSWORD || "local-loop-password",
  stateStore: (scope) => new CloudflareStateStore(scope),
});

const isProd = app.stage === "prod";
const prefix = isProd ? projectName : `${app.stage}-${projectName}`;
const productionDomain = process.env.LOOP_PUBLIC_DOMAIN || "loop.coey.dev";
const productionUrl = `https://${productionDomain}`;

const LOOP = DurableObjectNamespace<LoopDO>(`${projectName}-thread`, {
  className: "LoopDO",
  scriptName: `${prefix}-worker`,
  sqlite: true,
});

const DB = await D1Database(`${projectName}-db`, {
  name: `${prefix}-db`,
  migrationsDir: "migrations",
  adopt: true,
});

export const WORKER = await Worker(`${projectName}-worker`, {
  name: `${prefix}-worker`,
  entrypoint: "./worker/index.ts",
  adopt: true,
  bindings: {
    LOOP,
    AI: Ai(),
    LOOP_MODEL: process.env.LOOP_MODEL || "@cf/moonshotai/kimi-k2.6",
  },
  url: false,
});

const optionalAppEnv: Record<string, string> = {};
if (process.env.LOOP_INVITE_PASSWORD) optionalAppEnv.LOOP_INVITE_PASSWORD = process.env.LOOP_INVITE_PASSWORD;
if (process.env.LOOP_INVITE_PASSWORDS) optionalAppEnv.LOOP_INVITE_PASSWORDS = process.env.LOOP_INVITE_PASSWORDS;

export const APP = await SvelteKit(`${projectName}-app`, {
  name: `${prefix}-app`,
  adopt: true,
  url: true,
  bindings: { WORKER, DB },
  env: {
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || "local-loop-secret-change-before-deploy",
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL || (isProd ? productionUrl : "http://127.0.0.1:5176"),
    ...optionalAppEnv,
  },
  domains: isProd ? [{ domainName: productionDomain, adopt: true }] : undefined,
});

await app.finalize();
