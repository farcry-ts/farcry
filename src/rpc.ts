import * as t from "io-ts";
import { PathReporter } from "io-ts/lib/PathReporter";

import jayson, { JSONRPCVersionTwoRequest } from "jayson";
import { Request, Response, Handler } from "express";

export interface MethodSpec<P extends t.Props, R extends t.Mixed> {
  name: string;
  returns: R;
  params: t.TypeC<P>; // How to make this optional?
}

export interface MethodSpecs {
  [name: string]: MethodSpec<any, any>;
}

interface MethodBody<P extends t.Props, C, R extends t.Mixed> {
  (params: t.TypeOf<t.TypeC<P>>, context: C): Promise<t.TypeOf<R>>;
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

export function createRpcHandler<C extends {} = {}>() {
  const methods: Record<string, jayson.MethodHandlerContext> = {};
  const specs: MethodSpecs = {};

  return {
    method<P extends t.Props, R extends t.Mixed>(
      spec: MethodSpec<P, R>,
      body: MethodBody<P, C, R>
    ) {
      const jaysonCallback: jayson.MethodHandlerContext = async function (
        params,
        context,
        callback
      ) {
        if (!spec.params.is(params)) {
          const decoded = spec.params.decode(params);
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
          const code = isDomainError(err)
            ? err.code
            : RpcErrorCode.DOMAIN_ERROR;

          return callback({
            code,
            message: err.message,
          });
        }
      };

      methods[spec.name] = jaysonCallback;
      specs[spec.name] = spec;
    },

    middleware(buildContext?: ContextBuilder<C>): Handler {
      const server = new jayson.Server(methods, { useContext: true });

      interface RequestWithBody extends Request {
        body: JSONRPCVersionTwoRequest | JSONRPCVersionTwoRequest[];
      }

      return async function (req: RequestWithBody, res: Response) {
        try {
          const context = await (buildContext?.(req) ?? {});
          server.call(req.body, context, function (err: any, result: any) {
            // TODO: Can we be sure that `err' is always a JSON-RPC error?
            res.send(result || err);
          });
        } catch (err) {
          console.error("Failed to create RPC context: " + err.toString());
          res.sendStatus(500);
        }
      };
    },

    specs(): MethodSpecs {
      return { ...specs };
    },
  };
}
