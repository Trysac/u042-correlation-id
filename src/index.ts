/**
 * Framework-agnostic correlation ids for node:http servers.
 *
 * Extracts or creates W3C Trace Context identifiers, keeps them in
 * AsyncLocalStorage and builds outgoing propagation headers. The library
 * never logs and uses only node:async_hooks and node:crypto.
 *
 * @packageDocumentation
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";

const MAX_INPUT_LENGTH = 512;
const MAX_REQUEST_ID_LENGTH = 128;
const MAX_TRACESTATE_MEMBERS = 32;
const HEX2 = /^[0-9a-f]{2}$/;
const HEX16 = /^[0-9a-f]{16}$/;
const HEX32 = /^[0-9a-f]{32}$/;
const ZEROS = /^0+$/;
const REQUEST_ID = /^[A-Za-z0-9._:~+/=-]+$/;
const HEADER_TOKEN = /^[a-z0-9!#$%&'*+.^_`|~-]{1,64}$/;
const RESERVED_HEADERS = new Set(["traceparent", "tracestate"]);

type MaybeText = string | undefined;
type HeaderValue = string | string[] | undefined;
type Emit = (type: CorrelationEventType) => void;

/** Stable machine-readable error codes of {@link CorrelationError}. */
export type CorrelationErrorCode = "invalid_option" | "invalid_generator";

/** Base error of this library. Messages are static and never echo input. */
export class CorrelationError extends Error {
  /** Stable machine-readable code. */
  readonly code: CorrelationErrorCode;

  /**
   * @param code - Stable error code.
   * @param message - Short static description.
   */
  constructor(code: CorrelationErrorCode, message: string) {
    super(message);
    this.name = "CorrelationError";
    this.code = code;
  }
}

/** Correlation identifiers of one request. */
export interface CorrelationContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  requestId: string;
  sampled: boolean;
  tracestate?: string;
}

/** Result of {@link parseTraceparent}. */
export interface Traceparent {
  version: string;
  traceId: string;
  parentId: string;
  flags: number;
}

/** Types of events reported through `onEvent`. */
export type CorrelationEventType =
  | "invalid_traceparent"
  | "invalid_request_id"
  | "invalid_tracestate";

/** Event reported when an incoming header is ignored. Carries no values. */
export interface CorrelationEvent {
  readonly type: CorrelationEventType;
}

/** Source of new trace and span ids (lowercase hex, not all zeros). */
export interface IdGenerator {
  traceId(): string;
  spanId(): string;
}

/** Options of {@link createCorrelation}. */
export interface CorrelationOptions {
  /** Lowercase header token carrying the request id. Default `x-request-id`. */
  requestIdHeader?: string;
  /** Accept a valid incoming request id. Default `true`. */
  trustIncomingRequestId?: boolean;
  /** Custom id source. Default uses node:crypto. */
  idGenerator?: IdGenerator;
  /** Receives the type of every ignored header, never its value. */
  onEvent?: (e: CorrelationEvent) => void;
}

/** Minimal request shape (satisfied by node:http IncomingMessage). */
export interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
}

/** Minimal response shape (satisfied by node:http ServerResponse). */
export interface ResponseLike {
  setHeader(name: string, value: string): unknown;
}

/** Correlation handle returned by {@link createCorrelation}. */
export interface Correlation {
  /**
   * Builds the context, sets the request id response header and runs `next`
   * inside the AsyncLocalStorage scope.
   *
   * @throws {CorrelationError} With code `invalid_generator` when the id
   * generator returns a malformed id.
   */
  run<T>(req: RequestLike, res: ResponseLike, next: () => T): T;
  /** Frozen copy of the current context, or undefined outside `run()`. */
  getCorrelation(): CorrelationContext | undefined;
  /** Headers to propagate downstream; empty outside `run()`. */
  outgoingHeaders(): Record<string, string>;
}

/** Next callback of Express style middleware. */
export type Next = () => void;

/** Express compatible middleware. */
export type ExpressMiddleware = (req: RequestLike, res: ResponseLike, next: Next) => void;

/** Minimal Fastify request. */
export interface FastifyRequestLike {
  raw: RequestLike;
}

/** Minimal Fastify reply. */
export interface FastifyReplyLike {
  raw: ResponseLike;
}

/** Fastify `onRequest` hook. */
export type FastifyHook = (req: FastifyRequestLike, reply: FastifyReplyLike, done: Next) => void;

function isValidId(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && pattern.test(value) && !ZEROS.test(value);
}

function isRequestId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_REQUEST_ID_LENGTH &&
    REQUEST_ID.test(value)
  );
}

function hasControlChar(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function countMembers(value: string): number {
  return value.split(",").filter((member) => member.trim() !== "").length;
}

/**
 * Parses a W3C Trace Context Level 1 `traceparent` header (section 3.2).
 *
 * Version `ff` is invalid, ids must be lowercase hex and not all zeros. For
 * versions above `00` the first four fields are parsed when the value is 55
 * characters long or the 56th character is `-`. Values longer than 512
 * characters are never parsed.
 *
 * @param value - Raw header value.
 * @returns The parsed fields, or null when the header is invalid.
 */
export function parseTraceparent(value: MaybeText): Traceparent | null {
  if (typeof value !== "string") {
    return null;
  }
  if (value.length < 55 || value.length > MAX_INPUT_LENGTH) {
    return null;
  }
  const version = value.slice(0, 2);
  if (!HEX2.test(version) || version === "ff") {
    return null;
  }
  if (value[2] !== "-" || value[35] !== "-" || value[52] !== "-") {
    return null;
  }
  const traceId = value.slice(3, 35);
  const parentId = value.slice(36, 52);
  const flags = value.slice(53, 55);
  if (!isValidId(traceId, HEX32) || !isValidId(parentId, HEX16)) {
    return null;
  }
  if (!HEX2.test(flags)) {
    return null;
  }
  if (version === "00") {
    if (value.length !== 55) {
      return null;
    }
  } else if (value.length > 55 && value[55] !== "-") {
    return null;
  }
  return { version, traceId, parentId, flags: Number.parseInt(flags, 16) };
}

/**
 * Formats an outgoing `traceparent` header. The version is always `00`.
 *
 * @param ctx - Trace id, span id and sampled flag.
 * @returns The header value.
 * @throws {CorrelationError} With code `invalid_option` for malformed ids.
 */
export function formatTraceparent(
  ctx: Pick<CorrelationContext, "traceId" | "spanId" | "sampled">,
): string {
  if (!isValidId(ctx.traceId, HEX32) || !isValidId(ctx.spanId, HEX16)) {
    throw new CorrelationError("invalid_option", "bad trace or span id");
  }
  const flags = ctx.sampled ? "01" : "00";
  return `00-${ctx.traceId}-${ctx.spanId}-${flags}`;
}

function randomHex(bytes: number): string {
  for (;;) {
    const id = randomBytes(bytes).toString("hex");
    if (!ZEROS.test(id)) {
      return id;
    }
  }
}

const defaultGenerator: IdGenerator = {
  traceId: () => randomHex(16),
  spanId: () => randomHex(8),
};

interface Resolved {
  readonly header: string;
  readonly trust: boolean;
  readonly generator: IdGenerator;
  readonly emit: Emit;
}

function makeEmitter(onEvent: ((e: CorrelationEvent) => void) | undefined): Emit {
  return (type) => {
    if (onEvent === undefined) {
      return;
    }
    try {
      onEvent(Object.freeze({ type }));
    } catch {
      // A failing observer must never affect request handling.
    }
  };
}

function resolve(options: CorrelationOptions | undefined): Resolved {
  const o = options ?? {};
  if (typeof o !== "object" || o === null) {
    throw new CorrelationError("invalid_option", "options must be an object");
  }
  const header = o.requestIdHeader ?? "x-request-id";
  if (typeof header !== "string" || !HEADER_TOKEN.test(header)) {
    throw new CorrelationError("invalid_option", "bad requestIdHeader");
  }
  if (RESERVED_HEADERS.has(header)) {
    throw new CorrelationError("invalid_option", "reserved requestIdHeader");
  }
  const trust = o.trustIncomingRequestId ?? true;
  if (typeof trust !== "boolean") {
    throw new CorrelationError("invalid_option", "bad trustIncomingRequestId");
  }
  const generator = o.idGenerator ?? defaultGenerator;
  if (
    typeof generator !== "object" ||
    generator === null ||
    typeof generator.traceId !== "function" ||
    typeof generator.spanId !== "function"
  ) {
    throw new CorrelationError("invalid_option", "bad idGenerator");
  }
  if (o.onEvent !== undefined && typeof o.onEvent !== "function") {
    throw new CorrelationError("invalid_option", "bad onEvent");
  }
  return { header, trust, generator, emit: makeEmitter(o.onEvent) };
}

function generateId(source: () => string, pattern: RegExp): string {
  let id: unknown;
  try {
    id = source();
  } catch {
    throw new CorrelationError("invalid_generator", "id generator threw");
  }
  if (!isValidId(id, pattern)) {
    throw new CorrelationError("invalid_generator", "malformed generated id");
  }
  return id;
}

function firstValue(raw: HeaderValue): MaybeText {
  return Array.isArray(raw) ? raw[0] : raw;
}

function readTraceparent(raw: HeaderValue): Traceparent | null {
  if (Array.isArray(raw)) {
    return raw.length === 1 ? parseTraceparent(raw[0]) : null;
  }
  return parseTraceparent(raw);
}

function readTracestate(raw: HeaderValue, emit: Emit): MaybeText {
  const value = firstValue(raw);
  if (typeof value !== "string") {
    return undefined;
  }
  if (value.length > MAX_INPUT_LENGTH || hasControlChar(value)) {
    emit("invalid_tracestate");
    return undefined;
  }
  const members = countMembers(value);
  if (members > MAX_TRACESTATE_MEMBERS) {
    emit("invalid_tracestate");
    return undefined;
  }
  return members === 0 ? undefined : value;
}

function readRequestId(raw: HeaderValue, cfg: Resolved): MaybeText {
  if (!cfg.trust) {
    return undefined;
  }
  const value = firstValue(raw);
  if (value === undefined) {
    return undefined;
  }
  if (value.length <= MAX_INPUT_LENGTH && isRequestId(value)) {
    return value;
  }
  cfg.emit("invalid_request_id");
  return undefined;
}

function build(req: RequestLike, cfg: Resolved): CorrelationContext {
  const headers = req.headers;
  const newTraceId = generateId(cfg.generator.traceId, HEX32);
  const spanId = generateId(cfg.generator.spanId, HEX16);
  const rawParent = headers.traceparent;
  const incoming = readTraceparent(rawParent);
  if (rawParent !== undefined && incoming === null) {
    cfg.emit("invalid_traceparent");
  }
  const traceId = incoming === null ? newTraceId : incoming.traceId;
  const tracestate = incoming === null ? undefined : readTracestate(headers.tracestate, cfg.emit);
  const incomingId = readRequestId(headers[cfg.header], cfg);
  const sampled = incoming !== null && (incoming.flags & 1) === 1;
  return {
    traceId,
    spanId,
    requestId: incomingId ?? traceId,
    sampled,
    ...(incoming === null ? {} : { parentSpanId: incoming.parentId }),
    ...(tracestate === undefined ? {} : { tracestate }),
  };
}

/**
 * Creates a correlation handle.
 *
 * A request without a valid traceparent starts a new trace that is not
 * sampled. The request id defaults to the trace id.
 *
 * @param options - Optional configuration.
 * @returns The correlation handle.
 * @throws {CorrelationError} With code `invalid_option` for bad options.
 */
export function createCorrelation(options?: CorrelationOptions): Correlation {
  const cfg = resolve(options);
  const storage = new AsyncLocalStorage<CorrelationContext>();
  return {
    run<T>(req: RequestLike, res: ResponseLike, next: () => T): T {
      const ctx = Object.freeze(build(req, cfg));
      res.setHeader(cfg.header, ctx.requestId);
      return storage.run(ctx, next);
    },
    getCorrelation(): CorrelationContext | undefined {
      const ctx = storage.getStore();
      return ctx === undefined ? undefined : Object.freeze({ ...ctx });
    },
    outgoingHeaders(): Record<string, string> {
      const ctx = storage.getStore();
      if (ctx === undefined) {
        return {};
      }
      const out: Record<string, string> = {
        traceparent: formatTraceparent(ctx),
        [cfg.header]: ctx.requestId,
      };
      if (ctx.tracestate !== undefined) {
        out.tracestate = ctx.tracestate;
      }
      return out;
    },
  };
}

/**
 * Express middleware that runs the rest of the chain inside the context.
 *
 * @param c - Correlation handle.
 * @returns The middleware.
 */
export function expressMiddleware(c: Correlation): ExpressMiddleware {
  return (req, res, next) => {
    c.run(req, res, next);
  };
}

/**
 * Fastify hook, register it with `addHook("onRequest", hook)`.
 *
 * @param c - Correlation handle.
 * @returns The hook.
 */
export function fastifyHook(c: Correlation): FastifyHook {
  return (req, reply, done) => {
    c.run(req.raw, reply.raw, done);
  };
}
