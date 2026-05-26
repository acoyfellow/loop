import { spawn } from "node:child_process";

const children = [
  spawn("bun", ["run", "dev:worker"], { stdio: "inherit", env: process.env }),
  spawn("bun", ["run", "dev:app"], { stdio: "inherit", env: process.env }),
];

function stop() {
  for (const child of children) child.kill("SIGTERM");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const exitCode = await new Promise((resolve) => {
  for (const child of children) child.on("exit", (code) => resolve(code ?? 0));
});
stop();
process.exit(exitCode);
