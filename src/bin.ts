#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { extname, resolve, normalize } from "node:path";
import { parseArgs } from "node:util";

import chalk from "chalk";
import { watch } from "chokidar";
import JSON5 from "json5";
import { Low } from "lowdb";
import type { Adapter } from "lowdb";
import { DataFile, JSONFile } from "lowdb/node";
import type { PackageJson } from "type-fest";

import { fileURLToPath } from "node:url";
import { NormalizedAdapter } from "./adapters/normalized-adapter.ts";
import type { RawData } from "./adapters/normalized-adapter.ts";
import { Observer } from "./adapters/observer.ts";
import { createApp } from "./app.ts";
import type { Data } from "./service.ts";

function help() {
  console.log(`Usage: json-server [options] <file>

Options:
  -p, --port <port>  Port (default: 3000)
  -h, --host <host>  Host (default: localhost)
  -s, --static <dir> Static files directory (multiple allowed)
  --help             Show this message
  --version          Show version number
`);
}

// Parse args
/**
 * Validate database file path to prevent path traversal attacks
 */
function validateDbPath(filePath: string): string {
  if (!filePath) {
    throw new Error('Database file path is required')
  }
  
  // Reject absolute paths
  if (filePath.startsWith('/')) {
    throw new Error('Absolute paths are not allowed')
  }
  
  // Reject path traversal attempts
  if (filePath.includes('..')) {
    throw new Error('Path traversal sequences (..) are not allowed')
  }
  
  // Resolve to current working directory and verify it stays within bounds
  const resolved = resolve(normalize(filePath))
  const cwd = resolve(process.cwd())
  
  if (!resolved.startsWith(cwd)) {
    throw new Error('Database path must be within the current working directory')
  }
  
  return resolved
}

function args(): {
  file: string;
  port: number;
  host: string;
  static: string[];
} {
  try {
    const { values, positionals } = parseArgs({
      options: {
        port: {
          type: "string",
          short: "p",
          default: process.env["PORT"] ?? "3000",
        },
        host: {
          type: "string",
          short: "h",
          default: process.env["HOST"] ?? "localhost",
        },
        static: {
          type: "string",
          short: "s",
          multiple: true,
          default: [],
        },
        help: {
          type: "boolean",
        },
        version: {
          type: "boolean",
        },
        // Deprecated
        watch: {
          type: "boolean",
          short: "w",
        },
      },
      allowPositionals: true,
    });

    // --version
    if (values.version) {
      const pkg = JSON.parse(
        readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf-8"),
      ) as PackageJson;
      console.log(pkg.version);
      process.exit();
    }

    // Handle --watch
    if (values.watch) {
      console.log(
        chalk.yellow(
          "--watch/-w can be omitted, JSON Server 1+ watches for file changes by default",
        ),
      );
    }

    if (values.help || positionals.length === 0) {
      help();
      process.exit();
    }

    // Validate database file path
    const dbFile = positionals[0] ?? "";
    let validatedFile: string;
    try {
      validatedFile = validateDbPath(dbFile);
    } catch (err) {
      console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`))
      process.exit(1);
    }

    // App args and options
    return {
      file: validatedFile,
      port: parseInt(values.port as string),
      host: values.host as string,
      static: values.static as string[],
    };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
      console.log(chalk.red((e as NodeJS.ErrnoException).message.split(".")[0]));
      help();
      process.exit(1);
    } else {
      throw e;
    }
  }
}

const { file, port, host, static: staticArr } = args();

if (!existsSync(file)) {
  console.log(chalk.red(`File ${file} not found`));
  process.exit(1);
}

// Handle empty string JSON file
if (readFileSync(file, "utf-8").trim() === "") {
  writeFileSync(file, "{}");
}

// Set up database
let adapter: Adapter<RawData>;
if (extname(file) === ".json5") {
  adapter = new DataFile<RawData>(file, {
    parse: JSON5.parse,
    stringify: JSON5.stringify,
  });
} else {
  adapter = new JSONFile<RawData>(file);
}
const observer = new Observer(new NormalizedAdapter(adapter));

const db = new Low<Data>(observer, {});
await db.read();

// Create app
const app = createApp(db, { logger: false, static: staticArr });

function logRoutes(data: Data) {
  console.log(chalk.bold("Endpoints:"));
  if (Object.keys(data).length === 0) {
    console.log(chalk.gray(`No endpoints found, try adding some data to ${file}`));
    return;
  }
  console.log(
    Object.keys(data)
      .map((key) => `${chalk.gray(`http://${host}:${port}/`)}${chalk.blue(key)}`)
      .join("\n"),
  );
}

const kaomojis = ["♡⸜(˶˃ ᵕ ˂˶)⸝♡", "♡( ◡‿◡ )", "( ˶ˆ ᗜ ˆ˵ )", "(˶ᵔ ᵕ ᵔ˶)"];

function randomItem(items: string[]): string {
  const index = Math.floor(Math.random() * items.length);
  return items.at(index) ?? "";
}

app.listen(port, () => {
  console.log(
    [
      chalk.bold(`JSON Server started on PORT :${port}`),
      chalk.gray("Press CTRL-C to stop"),
      chalk.gray(`Watching ${file}...`),
      "",
      chalk.magenta(randomItem(kaomojis)),
      "",
      chalk.bold("Index:"),
      chalk.gray(`http://localhost:${port}/`),
      "",
      chalk.bold("Static files:"),
      chalk.gray("Serving ./public directory if it exists"),
      "",
    ].join("\n"),
  );
  logRoutes(db.data);
});

// Watch file for changes
if (process.env["NODE_ENV"] !== "production") {
  let writing = false; // true if the file is being written to by the app
  let hadReadError = false;
  let prevEndpoints = "";

  observer.onWriteStart = () => {
    writing = true;
  };
  observer.onWriteEnd = () => {
    writing = false;
  };
  observer.onReadStart = () => {
    prevEndpoints = JSON.stringify(Object.keys(db.data).sort());
  };
  observer.onReadEnd = (data) => {
    if (data === null) {
      return;
    }

    const nextEndpoints = JSON.stringify(Object.keys(data).sort());
    if (hadReadError || prevEndpoints !== nextEndpoints) {
      console.log();
      logRoutes(data);
    }
    hadReadError = false;
  };
  watch(file).on("change", () => {
    // Do no reload if the file is being written to by the app
    if (!writing) {
      db.read().catch((e) => {
        if (e instanceof SyntaxError) {
          hadReadError = true;
          return console.log(chalk.red(["", `Error parsing ${file}`, e.message].join("\n")));
        }
        console.log(e);
      });
    }
  });
}
