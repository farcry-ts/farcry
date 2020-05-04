# farcry

Usage:

### rpc.ts

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

### index.ts

```typescript
import express from "express";
import bodyParser from "body-parser";
import rpc from "./rpc";

const app = express();
app.use("/rpc", bodyParser.json(), rpc.middleware());
app.listen(8080);
```

### Generate client code

```bash
farcry codegen --in rpc.ts --out RpcClient.ts
```

### In your client

```typescript
import { add } from "./RpcClient";

add({ x: 10, y: 20 }).then((result) => console.log(result));
```
