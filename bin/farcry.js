#!/usr/bin/env node

const { program } = require("commander");

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
  .option("--endpoint [string]", "The RPC endpoint", "/rpc")
  .action((params) => {
    const path = require("path");

    const inPath = path.resolve(process.env.PWD, params.in);
    const cwd = path.dirname(inPath);
    const projectPath = require("find-config")("tsconfig.json", {
      cwd,
    });

    require("ts-node").register({ project: projectPath });
    const rpc = require(inPath).default;
    const specs = rpc.specs();

    const { generateClient } = require("../dist/codegen");
    const output = generateClient(specs, {
      endpoint: params.endpoint,
      withDataloader: params.dataloader,
    });

    const outPath = path.resolve(process.env.PWD, params.out);
    require("fs").writeFileSync(outPath, output);
    console.log(
      `Wrote ${output.split("\n").length} lines of code to ${outPath}`
    );

    process.exit(0);
  });

program.parse(process.argv);
