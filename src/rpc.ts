import * as t from "io-ts";
import { PathReporter } from "io-ts/lib/PathReporter";

import jayson, { JSONRPCVersionTwoRequest } from "jayson";
import { Request, Response, Handler } from "express";

export interface MethodSpec<P extends t.Props, R> {
  name: string;
  returns: t.Type<R>;
  params: P;
  meta?: MethodMeta;
}

// This might become arbitrarily extensible via a type param to handler() later on
interface MethodMeta {
  noBatch?: boolean;
}

export interface MethodSpecs {
  [name: string]: MethodSpec<any, any>;
}

interface MethodBody<P extends t.Props, C, R> {
  (params: t.TypeOf<t.TypeC<P>>, context: C): Promise<R>;
}

interface ContextBuilder<T> {
  (req: Request): T | Promise<T>;
}

enum RpcErrorCode {
  INVALID_PARAMS = -31999,
  INVALID_RETURN,
  DOMAIN_ERROR,
}

const DomainErrorTag = Symbol("DomainErrorTag");

export class DomainError extends Error {
  private readonly [DomainErrorTag] = true;

  constructor(message: string, public readonly code: number) {
    super(message);
  }
}

function isDomainError(error: unknown): error is DomainError {
  return (error as any)[DomainErrorTag];
}

export function handler<C extends {} = {}>() {
  return new RpcHandler<C>();
}

class RpcHandler<C extends {} = {}> {
  private _methods: Record<string, jayson.MethodHandlerContext> = {};
  private _specs: MethodSpecs = {};

  method<P extends t.Props, R>(
    spec: MethodSpec<P, R>,
    body: MethodBody<P, C, R>
  ) {
    if (this._specs.hasOwnProperty(spec.name)) {
      throw new Error(
        "There is already a handler with name '" + spec.name + "'"
      );
    }

    const jaysonCallback: jayson.MethodHandlerContext = async function (
      params,
      context,
      callback
    ) {
      const paramsType = t.type(spec.params);
      if (!paramsType.is(params)) {
        const decoded = paramsType.decode(params);
        const errors = PathReporter.report(decoded);

        return callback({
          code: RpcErrorCode.INVALID_PARAMS,
          message: "Invalid parameters type",
          data: {
            errors,
          },
        });
      }

      try {
        const result = await body(params, context as C);
        if (!spec.returns.is(result)) {
          return callback({
            code: RpcErrorCode.INVALID_RETURN,
            message: "Invalid return type",
          });
        }
        return callback(null, result);
      } catch (err) {
        const code = isDomainError(err) ? err.code : RpcErrorCode.DOMAIN_ERROR;

        return callback({
          code,
          message: err.message,
        });
      }
    };

    this._methods[spec.name] = jaysonCallback;
    this._specs[spec.name] = spec;

    return this;
  }

  middleware(buildContext?: ContextBuilder<C>): Handler {
    const server = new jayson.Server(this._methods, { useContext: true });

    interface RequestWithBody extends Request {
      body: JSONRPCVersionTwoRequest | JSONRPCVersionTwoRequest[];
    }

    return async function (req: RequestWithBody, res: Response) {
      if (typeof req.body !== "object") {
        console.error("The request body must be an object");
        res.sendStatus(500);
        return;
      }

      let context = {};
      try {
        if (buildContext) {
          context = await buildContext(req);
        }
      } catch (err) {
        console.error("Failed to create RPC context: " + err.toString());
        res.sendStatus(500);
      }

      server.call(req.body, context, function (err: any, result: any) {
        // TODO: Can we be sure that `err' is always a JSON-RPC error?
        res.send(result || err);
      });
    };
  }

  specs(): MethodSpecs {
    return { ...this._specs };
  }
}
