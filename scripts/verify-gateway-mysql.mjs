import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const values = parseEnv(readFileSync(new URL("../server/.env", import.meta.url), "utf8"));
const database = new URL(process.env.DATABASE_URL ?? values.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(database.hostname) || (database.port && database.port !== '3306')) {
  throw new Error("The integration runner requires local MySQL on port 3306.");
}
const schema = `oncue_gateway_test_${randomUUID().replaceAll("-", "")}`;
const mysqlEnv = { ...process.env, MYSQL_PWD: decodeURIComponent(database.password) };
function sql(statement) {
  const result = spawnSync("docker", [
    "exec", "-i", "-e", "MYSQL_PWD", "mysql", "mysql",
    "--batch", "--skip-column-names", `--user=${decodeURIComponent(database.username)}`,
  ], { cwd: root, env: mysqlEnv, input: statement, encoding: "utf8" });
  if (result.status !== 0) throw new Error("Local MySQL command failed; check the mysql container and database permissions.");
}

sql(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;`);
database.pathname = `/${schema}`;
console.log(`Created isolated test schema: ${schema}`);
let child;
let interrupted = false;
const stop = () => {
  interrupted = true;
  child?.kill("SIGTERM");
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
try {
  const args = process.argv.slice(2);
  child = spawn("rtk", ["proxy", "cargo", ...(args.length ? args : [
    "test", "--manifest-path", "server/Cargo.toml", "--locked", "--", "--include-ignored", "--test-threads=1",
  ])], { cwd: root, stdio: "inherit", env: { ...process.env, TEST_DATABASE_URL: database.toString() } });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  process.exitCode = interrupted ? 130 : code;
} finally {
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
  sql(`DROP DATABASE \`${schema}\`;`);
  console.log(`Removed isolated test schema: ${schema}`);
}
