import Mustache from "mustache";
import * as t from "io-ts";

import { MethodSpecs } from "./rpc";

// TODO: This is a rouch proof-of-concept implementation. Improve with more sophistication

const methodTemplate = `
export function {{{name}}}({{{args}}}): Promise<{{{returnType}}}> {
  return call({
    method: "{{{name}}}",
    params: {{{params}}},
  }) as Promise<{{{returnType}}}>;
}
`.trim();

const callTemplateDataloader = `
import DataLoader from "dataloader";

const jsonRpcLoader = new DataLoader((methods) => callBatch(methods), {
  cache: false,
});

function callBatch(methods: any) {
  const withId = methods.map((method: any, id: number) => {
    return { ...method, id, jsonrpc: "2.0" };
  });

  return fetch("{{{endpoint}}}", {
    method: "POST",
    body: JSON.stringify(withId),
    headers: {
      "content-type": "application/json",
    },
  })
    .then((res) => res.json())
    .then((results) =>
      results
        .sort((a: any, b: any) => a.id - b.id)
        .map(
          (envelope: any) => envelope.result ?? Promise.reject(envelope.error)
        )
    );
}

function call(method: any) {
  return jsonRpcLoader.load(method);
}
`.trim();

const callTemplateNoDataloader = `
function call(method: any) {
  return fetch("{{{endpoint}}}", {
    method: "POST",
    body: JSON.stringify({ ...method, jsonrpc: "2.0", id: 0 }),
    headers: {
      "content-type": "application/json",
    },
  })
    .then((res) => res.json())
    .then((json) => json.result ?? Promise.reject(json.error));
}
`.trim();

function codegenMethod(
  name: string,
  returnType: t.Type<any>,
  paramsType: t.Type<any>
) {
  const hasNoParams = paramsType.name === "{  }"; // TODO: ugly! And brittle, if io-ts's implementation of `name' changes

  return Mustache.render(methodTemplate, {
    name,
    returnType: returnType.name,
    args: hasNoParams ? "" : `params: ${paramsType.name}`,
    params: hasNoParams ? "{}" : "params",
  });
}

function codegenCall(opts: CodegenOpts) {
  const { endpoint, withDataloader } = opts;
  const template = withDataloader
    ? callTemplateDataloader
    : callTemplateNoDataloader;
  return Mustache.render(template, { endpoint });
}

interface CodegenOpts {
  endpoint: string;
  withDataloader: boolean;
}

export function generateClient(specs: MethodSpecs, opts: CodegenOpts) {
  // TODO: not all parameter names are valid identifiers. Find a reliable way to validate them

  const codeCall = codegenCall(opts);
  const codeMethods = [];

  const identifierRe = /^[a-zA-Z0-9_]+$/; // TODO: do something more sophisticated

  for (const methodName of Object.keys(specs)) {
    if (!identifierRe.test(methodName)) {
      console.warn(`\`${methodName}' is not a valid method name. Skipping`);
      continue;
    }

    const spec = specs[methodName];
    const returnType = spec.returns;
    const paramsType = spec.params;

    codeMethods.push(codegenMethod(methodName, returnType, paramsType), "");
  }

  return [codeCall, "", ...codeMethods].join("\n");
}
