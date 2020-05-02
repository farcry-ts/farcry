import Mustache from "mustache";
import * as t from "io-ts";

import { MethodSpecs } from "./rpc";

const methodTemplate = `
export function {{{name}}}({{{args}}}): Promise<{{{returnType}}}> {
  return jsonRpcLoader.load({
    method: "{{{name}}}",
    params: {{{params}}}
  }) as Promise<{{{returnType}}}>;
}
`.trim();

const callTemplate = `
import DataLoader from "dataloader";

const jsonRpcLoader = new DataLoader((methods) => callBatch(methods), { cache: false });

function callBatch(methods: any) {
  const withId = methods.map((method: any, id: number) => {
    return { ...method, id, jsonrpc: "2.0" };
  });

  return fetch("/rpc", {
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
        .map((resultEnvelope: any) => resultEnvelope.result)
    );
}
`.trim();

function codegenMethod(
  name: string,
  returnType: t.TypeC<any>,
  paramsType: t.TypeC<any>
) {
  const hasNoParams = Object.keys(paramsType.props).length === 0;

  return Mustache.render(methodTemplate, {
    name,
    returnType: returnType.name,
    args: hasNoParams ? "" : `params: ${paramsType.name}`,
    params: hasNoParams ? "{}" : "params",
  });
}

function codegenCall(endpoint: string) {
  return Mustache.render(callTemplate, { endpoint });
}

interface CodegenOpts {
  endpoint: string;
}

export function generateClient(specs: MethodSpecs, opts: CodegenOpts) {
  const codeCall = codegenCall(opts.endpoint);
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

    // TODO: find a better approach for this. This one, for example, doesn't search deeply for incompatible names
    let failedParamName = false;

    if (paramsType != null) {
      const paramNames = Object.keys(paramsType.props);
      for (const paramName of paramNames) {
        if (!identifierRe.test(paramName)) {
          console.warn(
            `\’${paramName}' is not a valid method name. Skipping method \`${methodName}'`
          );
          failedParamName = true;
          break;
        }
      }
    }

    if (failedParamName) {
      continue;
    }

    codeMethods.push(codegenMethod(methodName, returnType, paramsType), "");
  }

  return [codeCall, "", ...codeMethods].join("\n");
}
