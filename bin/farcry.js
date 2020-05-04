#!/usr/bin/env node

const { program } = require("commander");

function panic(out) {
  console.error("Error:", out);
  process.exit(1);
}

program
  .command("codegen")
  .requiredOption(
    "--in [string]",
    "Path to TypeScript module with the RPC handler as default export"
  )
  .requiredOption(
    "--out [string]",
    "Path where this program will output client code"
  )
  .option(
    "--dataloader",
    'Use DataLoader (requires "dataloader" dependency)',
    false
  )
  .option("--endpoint [string]", "The JSON-RPC HTTP endpoint", "/rpc")
  .action((params) => {
    const path = require("path");
    const fs = require("fs");

    const inPath = path.resolve(process.env.PWD, params.in);
    if (!fs.existsSync(inPath)) {
      panic("Error: The input file doesn't exist");
    }

    const cwd = path.dirname(inPath);
    const projectPath = require("find-config")("tsconfig.json", {
      cwd,
    });

    require("ts-node").register({ project: projectPath });
    const rpc = require(inPath).default;

    if (rpc == null) {
      panic("Error: The input module doesn't have a default export");
    }

    if (typeof rpc.specs !== "function") {
      panic("Error: The input module default export isn't an RPC handler");
    }

    const { generateClient } = require("../dist/codegen");
    const output = generateClient(rpc.specs(), {
      endpoint: params.endpoint,
      withDataloader: params.dataloader,
    });

    const outPath = path.resolve(process.env.PWD, params.out);
    fs.writeFileSync(outPath, output);
    console.log(
      `Wrote ${output.split("\n").length} lines of code to ${outPath}`
    );

    process.exit(0);
  });

program.parse(process.argv);
