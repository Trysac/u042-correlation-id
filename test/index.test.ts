import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import * as lib from "../src/index.js";

const TRACE = "0af7651916cd43dd8448eb211c80319c";
const PARENT = "b7ad6b7169203331";
const VALID = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
const GEN = {
  traceId: () => "a".repeat(32),
  spanId: () => "1111111111111111",
};

type Hdrs = Record<string, string | string[] | undefined>;

function fakeRes() {
  const store = new Map<string, string>();
  return {
    setHeader(name: string, value: string): void {
      store.set(name, value);
    },
    getHeader(name: string): string | undefined {
      return store.get(name);
    },
    names(): string[] {
      return [...store.keys()];
    },
  };
}

interface Probe {
  ctx: lib.CorrelationContext | undefined;
  out: Record<string, string>;
  res: ReturnType<typeof fakeRes>;
  events: lib.CorrelationEvent[];
}

function probe(headers: Hdrs, options: lib.CorrelationOptions = {}): Probe {
  const events: lib.CorrelationEvent[] = [];
  const c = lib.createCorrelation({
    ...options,
    onEvent: (e) => events.push(e),
  });
  const res = fakeRes();
  const { ctx, out } = c.run({ headers }, res, () => ({
    ctx: c.getCorrelation(),
    out: c.outgoingHeaders(),
  }));
  return { ctx, out, res, events };
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof lib.CorrelationError) {
      expect(error.message.length).toBeLessThan(200);
      return error.code;
    }
    return "other";
  }
  return undefined;
}

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

async function withServer(
  handler: http.RequestListener,
  run: (port: number) => Promise<void>,
): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    await run((server.address() as AddressInfo).port);
  } finally {
    const closed = new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    server.closeAllConnections();
    await closed;
  }
}

function get(port: number, headers: Record<string, string>): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const options = { host: "127.0.0.1", port, headers, agent: false };
    const req = http.request(options, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        body += chunk;
      });
      res.on("end", () => {
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function traceIdFor(i: number): string {
  return i.toString(16).padStart(32, "0");
}

function tracedGet(port: number, id: string, delay: number): Promise<Reply> {
  return get(port, {
    traceparent: `00-${id}-${PARENT}-01`,
    "x-delay": String(delay),
  });
}

describe("parseTraceparent", () => {
  it("parses the W3C example headers", () => {
    expect(
      lib.parseTraceparent(
        "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
      ),
    ).toEqual({
      version: "00",
      traceId: "0af7651916cd43dd8448eb211c80319c",
      parentId: "b7ad6b7169203331",
      flags: 1,
    });
    const unsampled = lib.parseTraceparent(
      "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00",
    );
    expect(unsampled?.flags).toBe(0);
    expect(unsampled?.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
  });

  it("returns null for invalid headers", () => {
    const bad: Array<string | undefined> = [
      "ff-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
      "00-0AF7651916CD43DD8448EB211C80319C-b7ad6b7169203331-01",
      `00-${"0".repeat(32)}-b7ad6b7169203331-01`,
      `00-0af7651916cd43dd8448eb211c80319c-${"0".repeat(16)}-01`,
      `${VALID} `,
      `${VALID}, ${VALID}`,
      "00-0af7651916cd43dd8448eb211c80319g-b7ad6b7169203331-01",
      "00_0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
      "00-0af7651916cd43dd8448eb211c80319c_b7ad6b7169203331-01",
      "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331_01",
      "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-0g",
      "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01-extra",
      "0g-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
      `01-${TRACE}-${PARENT}-01-${"x".repeat(600)}`,
      "",
      undefined,
    ];
    for (const value of bad) {
      expect(lib.parseTraceparent(value)).toBeNull();
    }
    expect(lib.parseTraceparent(5 as unknown as string)).toBeNull();
  });

  it("handles future versions per section 3.2.4", () => {
    expect(
      lib.parseTraceparent(
        "01-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01-extra",
      ),
    ).toEqual({ version: "01", traceId: TRACE, parentId: PARENT, flags: 1 });
    expect(
      lib.parseTraceparent(`01-${TRACE}-${PARENT}-01`)?.version,
    ).toBe("01");
    expect(
      lib.parseTraceparent(
        "01-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01x",
      ),
    ).toBeNull();
    expect(
      lib.parseTraceparent(
        "01-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-0",
      ),
    ).toBeNull();
    const longest = `01-${TRACE}-${PARENT}-01-${"x".repeat(456)}`;
    expect(longest.length).toBe(512);
    expect(lib.parseTraceparent(longest)?.flags).toBe(1);
  });
});

describe("formatTraceparent", () => {
  it("always emits version 00", () => {
    const ids = { traceId: TRACE, spanId: PARENT };
    expect(lib.formatTraceparent({ ...ids, sampled: true })).toBe(VALID);
    expect(lib.formatTraceparent({ ...ids, sampled: false })).toBe(
      `00-${TRACE}-${PARENT}-00`,
    );
  });

  it("rejects malformed ids", () => {
    const bad = () =>
      lib.formatTraceparent({ traceId: "zz", spanId: PARENT, sampled: true });
    expect(codeOf(bad)).toBe("invalid_option");
    const zero = () =>
      lib.formatTraceparent({
        traceId: TRACE,
        spanId: "0".repeat(16),
        sampled: true,
      });
    expect(codeOf(zero)).toBe("invalid_option");
  });
});

describe("context creation", () => {
  it("continues an incoming trace", () => {
    const r = probe({ traceparent: VALID }, { idGenerator: GEN });
    expect(r.ctx?.traceId).toBe("0af7651916cd43dd8448eb211c80319c");
    expect(r.ctx?.parentSpanId).toBe("b7ad6b7169203331");
    expect(r.ctx?.spanId).toBe("1111111111111111");
    expect(r.ctx?.sampled).toBe(true);
    expect(r.out.traceparent).toBe(
      "00-0af7651916cd43dd8448eb211c80319c-1111111111111111-01",
    );
    expect(r.out["x-request-id"]).toBe(TRACE);
    expect(r.events).toEqual([]);
  });

  it("starts a new trace without a traceparent", () => {
    const r = probe({}, { idGenerator: GEN });
    expect(r.ctx?.traceId).toBe("a".repeat(32));
    expect(r.ctx?.requestId).toBe("a".repeat(32));
    expect(r.ctx?.sampled).toBe(false);
    expect(r.ctx && "parentSpanId" in r.ctx).toBe(false);
    expect(r.out.traceparent).toBe(`00-${"a".repeat(32)}-1111111111111111-00`);
    expect(r.res.names()).toEqual(["x-request-id"]);
    expect(r.events).toEqual([]);
  });

  it("derives sampled from the lowest flag bit", () => {
    expect(probe({ traceparent: `00-${TRACE}-${PARENT}-03` }).ctx?.sampled).toBe(
      true,
    );
    expect(probe({ traceparent: `00-${TRACE}-${PARENT}-02` }).ctx?.sampled).toBe(
      false,
    );
  });

  it("uses random ids by default", () => {
    const a = probe({});
    const b = probe({});
    expect(a.ctx?.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(a.ctx?.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(a.ctx?.traceId).not.toBe(b.ctx?.traceId);
    expect(a.ctx?.traceId).not.toMatch(/^0+$/);
  });

  it("reports invalid traceparent values by type only", () => {
    const values: Hdrs[] = [
      { traceparent: "secret-token-value" },
      { traceparent: [VALID, VALID] },
      { traceparent: [] },
      { traceparent: "" },
    ];
    for (const headers of values) {
      const r = probe(headers, { idGenerator: GEN });
      expect(r.events).toEqual([{ type: "invalid_traceparent" }]);
      expect(r.ctx?.traceId).toBe("a".repeat(32));
    }
    const single = probe({ traceparent: [VALID] });
    expect(single.ctx?.traceId).toBe(TRACE);
    expect(single.events).toEqual([]);
  });

  it("never leaks header values into events", () => {
    const r = probe({
      traceparent: "secret-token-value",
      "x-request-id": "bad value secret",
    });
    expect(JSON.stringify(r.events)).not.toContain("secret");
    for (const e of r.events) {
      expect(Object.keys(e)).toEqual(["type"]);
    }
  });

  it("returns a frozen copy and nothing outside run()", () => {
    const c = lib.createCorrelation({ idGenerator: GEN });
    expect(c.getCorrelation()).toBeUndefined();
    expect(c.outgoingHeaders()).toEqual({});
    const res = fakeRes();
    c.run({ headers: {} }, res, () => {
      const first = c.getCorrelation();
      expect(Object.isFrozen(first)).toBe(true);
      expect(c.getCorrelation()).not.toBe(first);
      expect(c.getCorrelation()).toEqual(first);
    });
  });

  it("sets the response header before next and returns its result", () => {
    const c = lib.createCorrelation({ idGenerator: GEN });
    const res = fakeRes();
    const seen = c.run({ headers: {} }, res, () => res.getHeader("x-request-id"));
    expect(seen).toBe("a".repeat(32));
  });
});

describe("tracestate", () => {
  it("forwards a valid tracestate unchanged", () => {
    const r = probe({ traceparent: VALID, tracestate: "congo=t61rcWkgMzE" });
    expect(r.ctx?.tracestate).toBe("congo=t61rcWkgMzE");
    expect(r.out.tracestate).toBe("congo=t61rcWkgMzE");
    expect(r.events).toEqual([]);
  });

  it("uses the first element of an array and ignores empty values", () => {
    const first = probe({ traceparent: VALID, tracestate: ["a=1", "b=2"] });
    expect(first.ctx?.tracestate).toBe("a=1");
    const empty = probe({ traceparent: VALID, tracestate: " , " });
    expect(empty.ctx && "tracestate" in empty.ctx).toBe(false);
    expect(empty.events).toEqual([]);
  });

  it("accepts the limits and ignores empty members", () => {
    const names = Array.from({ length: 32 }, (_, i) => `k${i}=v`);
    const withEmpty = `${names.join(",")},,`;
    const r32 = probe({ traceparent: VALID, tracestate: withEmpty });
    expect(r32.ctx?.tracestate).toBe(withEmpty);
    const edge = `a=${"b".repeat(510)}`;
    expect(edge.length).toBe(512);
    expect(probe({ traceparent: VALID, tracestate: edge }).ctx?.tracestate).toBe(
      edge,
    );
  });

  it("drops tracestate for an invalid traceparent", () => {
    const r = probe({
      traceparent: "zz",
      tracestate: "congo=t61rcWkgMzE",
    });
    expect(r.events).toEqual([{ type: "invalid_traceparent" }]);
    expect(r.ctx && "tracestate" in r.ctx).toBe(false);
    expect(r.out.tracestate).toBeUndefined();
  });

  it("drops tracestate without any traceparent", () => {
    const r = probe({ tracestate: "congo=t61rcWkgMzE" });
    expect(r.ctx?.tracestate).toBeUndefined();
    expect(r.events).toEqual([]);
  });

  it("drops oversized, over-populated or control-char tracestate", () => {
    const names = Array.from({ length: 33 }, (_, i) => `k${i}=v`);
    const cases = [
      names.join(","),
      `a=${"b".repeat(511)}`,
      "congo=t61rcWkgMzE\u0001",
      "congo=t61\u007frcWkgMzE",
      "congo=t61\trcWkgMzE",
    ];
    for (const value of cases) {
      const r = probe({ traceparent: VALID, tracestate: value });
      expect(r.events).toEqual([{ type: "invalid_tracestate" }]);
      expect(r.ctx?.tracestate).toBeUndefined();
      expect(r.out.tracestate).toBeUndefined();
    }
  });
});

describe("request id", () => {
  it("keeps valid incoming ids", () => {
    for (const id of ["req-1:abc", "a".repeat(128)]) {
      const r = probe({ "x-request-id": id }, { idGenerator: GEN });
      expect(r.ctx?.requestId).toBe(id);
      expect(r.res.getHeader("x-request-id")).toBe(id);
      expect(r.events).toEqual([]);
    }
  });

  it("replaces invalid ids with the trace id", () => {
    const bad = ["a\r\nSet-Cookie: x", "a b", "a".repeat(129), "", "a\nb"];
    for (const id of bad) {
      const r = probe({ "x-request-id": id }, { idGenerator: GEN });
      expect(r.ctx?.requestId).toBe("a".repeat(32));
      expect(r.res.getHeader("x-request-id")).toBe("a".repeat(32));
      expect(r.events).toEqual([{ type: "invalid_request_id" }]);
    }
    const joined = probe({ traceparent: VALID, "x-request-id": "a b" });
    expect(joined.ctx?.requestId).toBe(TRACE);
  });

  it("never lets CR or LF reach a response header", () => {
    const attack = "abc\r\nSet-Cookie: session=1";
    const r = probe({ "x-request-id": attack });
    const header = r.res.getHeader("x-request-id") ?? "";
    expect(header).not.toMatch(/[\r\n ]/);
    expect(header).not.toContain("Set-Cookie");
    expect(r.out["x-request-id"]).not.toContain("\n");
  });

  it("does not echo incoming ids when trust is disabled", () => {
    const r = probe(
      { "x-request-id": "req-1:abc" },
      { trustIncomingRequestId: false, idGenerator: GEN },
    );
    expect(r.ctx?.requestId).toBe("a".repeat(32));
    expect(r.res.getHeader("x-request-id")).toBe("a".repeat(32));
    expect(r.events).toEqual([]);
  });

  it("supports a custom header and array values", () => {
    const r = probe(
      { "x-correlation-id": ["first-1", "second-2"] },
      { requestIdHeader: "x-correlation-id" },
    );
    expect(r.ctx?.requestId).toBe("first-1");
    expect(r.res.getHeader("x-correlation-id")).toBe("first-1");
    expect(r.out["x-correlation-id"]).toBe("first-1");
    expect(r.res.getHeader("x-request-id")).toBeUndefined();
  });
});

describe("async context", () => {
  it("survives await and setTimeout", async () => {
    const c = lib.createCorrelation({ idGenerator: GEN });
    const res = fakeRes();
    const seen = await c.run({ headers: { traceparent: VALID } }, res, async () => {
      await Promise.resolve();
      const afterAwait = c.getCorrelation()?.traceId;
      const afterTimer = await new Promise<string | undefined>((resolve) => {
        setTimeout(() => resolve(c.getCorrelation()?.traceId), 1);
      });
      return { afterAwait, afterTimer };
    });
    expect(seen).toEqual({ afterAwait: TRACE, afterTimer: TRACE });
    expect(c.getCorrelation()).toBeUndefined();
  });

  it("isolates 50 interleaved concurrent requests", async () => {
    const c = lib.createCorrelation();
    const handler: http.RequestListener = (req, res) => {
      c.run(req, res, async () => {
        const delay = Number(req.headers["x-delay"]);
        await new Promise((resolve) => setTimeout(resolve, delay));
        res.end(c.getCorrelation()?.traceId ?? "none");
      });
    };
    await withServer(handler, async (port) => {
      const ids = Array.from({ length: 50 }, (_, i) => traceIdFor(i + 1));
      const jobs = ids.map((id, i) => tracedGet(port, id, i % 7));
      const replies = await Promise.all(jobs);
      expect(replies.map((r) => r.body)).toEqual(ids);
      expect(replies.map((r) => r.headers["x-request-id"])).toEqual(ids);
    });
  });
});

describe("adapters", () => {
  it("expressMiddleware works with a structural fake", () => {
    const c = lib.createCorrelation({ idGenerator: GEN });
    const mw = lib.expressMiddleware(c);
    const res = fakeRes();
    let seen: string | undefined;
    mw({ headers: { traceparent: VALID } }, res, () => {
      seen = c.getCorrelation()?.traceId;
    });
    expect(seen).toBe(TRACE);
    expect(res.getHeader("x-request-id")).toBe(TRACE);
  });

  it("fastifyHook works with a structural fake", () => {
    const c = lib.createCorrelation({ idGenerator: GEN });
    const hook = lib.fastifyHook(c);
    const res = fakeRes();
    let seen: string | undefined;
    hook({ raw: { headers: { traceparent: VALID } } }, { raw: res }, () => {
      seen = c.getCorrelation()?.traceId;
    });
    expect(seen).toBe(TRACE);
    expect(res.getHeader("x-request-id")).toBe(TRACE);
  });

  it("adapters surface generator errors synchronously", () => {
    const c = lib.createCorrelation({
      idGenerator: { traceId: () => "zz", spanId: GEN.spanId },
    });
    const mw = lib.expressMiddleware(c);
    const hook = lib.fastifyHook(c);
    const res = fakeRes();
    const viaExpress = () => mw({ headers: {} }, res, () => undefined);
    const viaFastify = () =>
      hook({ raw: { headers: {} } }, { raw: res }, () => undefined);
    expect(codeOf(viaExpress)).toBe("invalid_generator");
    expect(codeOf(viaFastify)).toBe("invalid_generator");
  });

  it("both adapters work over node:http", async () => {
    const c = lib.createCorrelation();
    const mw = lib.expressMiddleware(c);
    const hook = lib.fastifyHook(c);
    const handler: http.RequestListener = (req, res) => {
      const respond = () => {
        res.end(c.getCorrelation()?.traceId ?? "none");
      };
      if (req.url === "/fastify") {
        hook({ raw: req }, { raw: res }, respond);
      } else {
        mw(req, res, respond);
      }
    };
    await withServer(handler, async (port) => {
      const reply = await get(port, { traceparent: VALID });
      expect(reply.status).toBe(200);
      expect(reply.body).toBe(TRACE);
      expect(reply.headers["x-request-id"]).toBe(TRACE);
      expect(reply.headers.traceparent).toBeUndefined();
    });
  });
});

describe("errors and options", () => {
  it("rejects invalid options with invalid_option", () => {
    const make = (o: unknown) => () =>
      lib.createCorrelation(o as lib.CorrelationOptions);
    expect(codeOf(make({ requestIdHeader: "X Bad" }))).toBe("invalid_option");
    expect(codeOf(make({ requestIdHeader: "" }))).toBe("invalid_option");
    expect(codeOf(make({ requestIdHeader: "X-Upper" }))).toBe("invalid_option");
    expect(codeOf(make({ requestIdHeader: 5 }))).toBe("invalid_option");
    expect(codeOf(make({ requestIdHeader: "traceparent" }))).toBe(
      "invalid_option",
    );
    expect(codeOf(make({ trustIncomingRequestId: "yes" }))).toBe(
      "invalid_option",
    );
    expect(codeOf(make({ idGenerator: {} }))).toBe("invalid_option");
    expect(codeOf(make({ idGenerator: null }))).toBe("invalid_option");
    expect(codeOf(make({ onEvent: "nope" }))).toBe("invalid_option");
    expect(codeOf(make(null))).toBe("invalid_option");
    expect(codeOf(make("text"))).toBe("invalid_option");
    expect(codeOf(make(undefined))).toBeUndefined();
  });

  it("does not echo the rejected value in the message", () => {
    try {
      lib.createCorrelation({ requestIdHeader: "X Bad" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(lib.CorrelationError);
      expect((error as Error).message).not.toContain("X Bad");
      expect((error as Error).name).toBe("CorrelationError");
    }
  });

  it("rejects malformed generated ids with invalid_generator", () => {
    const run = (gen: unknown) => () => {
      const c = lib.createCorrelation({ idGenerator: gen as lib.IdGenerator });
      c.run({ headers: {} }, fakeRes(), () => undefined);
    };
    const ok = { traceId: GEN.traceId, spanId: GEN.spanId };
    expect(codeOf(run({ ...ok, traceId: () => "zz" }))).toBe("invalid_generator");
    expect(codeOf(run({ ...ok, spanId: () => "zz" }))).toBe("invalid_generator");
    const zeros = { ...ok, traceId: () => "0".repeat(32) };
    expect(codeOf(run(zeros))).toBe("invalid_generator");
    const upper = { ...ok, spanId: () => "ABCDEF0123456789" };
    expect(codeOf(run(upper))).toBe("invalid_generator");
    const numeric = { ...ok, traceId: () => 5 };
    expect(codeOf(run(numeric))).toBe("invalid_generator");
    const throwing = {
      ...ok,
      spanId: () => {
        throw new Error("boom");
      },
    };
    expect(codeOf(run(throwing))).toBe("invalid_generator");
    expect(codeOf(run(ok))).toBeUndefined();
  });

  it("ignores errors thrown by onEvent", () => {
    const c = lib.createCorrelation({
      onEvent: () => {
        throw new Error("observer failure");
      },
    });
    const out = c.run({ headers: { traceparent: "zz" } }, fakeRes(), () => 7);
    expect(out).toBe(7);
  });
});
