# farcry

![Build & Test](https://github.com/farcry-ts/farcry/workflows/Build%20&%20Test/badge.svg)

FarCry is a library for TypeScript in NodeJS for type-safe RPC over HTTP. The core idea is to make a server application using FarCry the **single source of truth** with regards to types. Using a single specification of each method, you get **compile-time type safety**, **input validation**, **output validation** and **type-safe generated client code**.

With FarCry, you can speed up prototyping and application development significantly. Instead of REST, with its data-centrism, complexity and ambiguity, FarCry peforms client-server communication with [JSON-RPC](https://www.jsonrpc.org/), which is a lightweight but versatile standard. With built-in support for call batching, FarCry helps you reduce the number of HTTP requests the client needs to perform drastically.

The aim of FarCry is to be "the missing piece" -- a library that doesn't bring much new to the table, but which combines the work of others into a powerful, batteries-included solution. Credits go to [io-ts](https://github.com/gcanti/io-ts) for runtime type-safety, [Express](https://expressjs.com/) for HTTP, [jayson](https://github.com/tedeh/jayson) for JSON-RPC and [TypeScript](https://www.typescriptlang.org/) for the language.

## Usage

The fundamental element is the method specification. It contains the name and body of the method, as well as type information for the parameters and return value. Try violating the types, and you'll see an error in your editor immediately.

A handler combines any number of method specifications, and is used to form an Express-compatible middleware. Just use it in your route of choice, and you're ready to go. It's as simple as that! Top it off by generating some client code and put your methods to use immediately.

### Example:

#### rpc.ts

```typescript
import { handler } from "farcry";
import * as t from "io-ts";

export default handler().method(
  {
    name: "add",
    params: t.type({
      x: t.number,
      y: t.number,
    }),
    returns: t.number,
  },
  async function ({ x, y }) {
    return x + y;
  }
);
```

#### index.ts

```typescript
import express from "express";
import bodyParser from "body-parser";
import rpc from "./rpc";

const app = express();
app.use("/rpc", bodyParser.json(), rpc.middleware());
app.listen(8080);
```

#### Generate client code

```bash
farcry codegen --in rpc.ts --out RpcClient.ts
```

#### In your client

```typescript
import { add } from "./RpcClient";

add({ x: 10, y: 20 }).then((result) => console.log(result));
```

##### With react-farcry (experimental)

```tsx
import { useMethod } from "react-farcry";
import { add } from "./RpcClient";

function Sum() {
  const sum = useMethod(add, { x: 10, y: 20 });
  return <p>The sum is {sum}</p>;
}
```
