import type { DefineAPI, SDK } from "caido:plugin";
import {
  type DedupeKey,
  type Request,
  RequestSpec,
  type Response,
} from "caido:utils";

export type ScanTarget = {
  kind: "SavedRequest";
  requestId: string;
};

export type ScanConfig = {
  maxMutations: number;
  includeBuiltInCandidates: boolean;
  candidateFields: Array<string>;
  customValues: Array<string>;
  mutateExistingFields: boolean;
  valueModes: {
    booleanTrue: boolean;
    stringAdmin: boolean;
    numberOne: boolean;
    numberPlusOne: boolean;
    numberMinusOne: boolean;
  };
  confirmPersistence: boolean;
  persistenceDelayMs: number;
  verification:
    | { kind: "Disabled" }
    | {
        kind: "FollowUp";
        url: string;
        method: string;
        body: string;
        delayMs: number;
      };
};

export type RequestSummary = {
  id: string;
  method: string;
  url: string;
  createdAt: string;
  hasResponse: boolean;
};

export type RequestPreview = {
  requestId: string;
  requestText: string;
  responseText: string | undefined;
};

export type ScanFinding = {
  id: string;
  requestId: string;
  field: string;
  value: string;
  kind:
    | "Reflected"
    | "Persisted"
    | "CodeChanged"
    | "StateChanged"
    | "NonJsonResponse"
    | "NoResponse";
  baselineCode: number | undefined;
  mutatedCode: number | undefined;
  persistedCode: number | undefined;
  mutatedRequestId: string | undefined;
  persistedRequestId: string | undefined;
  verifyBaselineRequestId: string | undefined;
  verifyRequestId: string | undefined;
  baselineBodySnippet: string | undefined;
  mutatedBodySnippet: string | undefined;
  persistedBodySnippet: string | undefined;
  message: string;
};

export type ScanResult = {
  baselineRequestId: string;
  findings: Array<ScanFinding>;
};

export type Result<T> =
  | {
      kind: "Error";
      error: string;
    }
  | {
      kind: "Ok";
      value: T;
    };

type JSONPrimitive = string | number | boolean;
type JSONObject = { [key: string]: JSONValue };
type JSONValue =
  | string
  | number
  | boolean
  | undefined
  | JSONObject
  | Array<JSONValue>;

type PrimitiveCandidate = { kind: "Fixed"; value: JSONValue };
type NumericDeltaCandidate = { kind: "NumericDelta"; delta: number };
type ValueCandidate = PrimitiveCandidate | NumericDeltaCandidate;

type Mutation = {
  field: string;
  value: JSONValue;
  bodyText: string;
};

type CreateFindingsInput = {
  requestId: string;
  findings: Array<{
    field: string;
    value: string;
    kind: ScanFinding["kind"];
    message: string;
    mutatedRequestId?: string;
    persistedRequestId?: string;
    verifyRequestId?: string;
  }>;
};

type CreateFindingsResult = {
  created: number;
};

type SaveRawRequestInput = {
  host: string;
  port: number;
  isTls: boolean;
  raw: string;
};

const PluginMarkerHeader = "X-Mass-Assignment-Radar";

let shouldStopScan = false;

const stopScan = (sdk: SDK) => {
  sdk.console.log("Stopping scan...");
  shouldStopScan = true;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isPluginGeneratedRequest = (request: Request): boolean => {
  const marker =
    request.getHeader(PluginMarkerHeader)?.[0] ??
    request.getHeader(PluginMarkerHeader.toLowerCase())?.[0];
  return marker !== undefined;
};

const safeStringify = (value: JSONValue | undefined): string => {
  if (value === undefined) {
    return "undefined";
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return String(value);
  }
  return JSON.stringify(value);
};

const parseJsonValue = (text: string): Result<JSONValue> => {
  try {
    return { kind: "Ok", value: JSON.parse(text) };
  } catch {
    return { kind: "Error", error: "body is not valid JSON" };
  }
};

const getContentType = (request: Request): string | undefined => {
  const contentType =
    request.getHeader("Content-Type")?.[0] ??
    request.getHeader("content-type")?.[0];
  return contentType;
};

const isJsonRequest = (request: Request): boolean => {
  const contentType = getContentType(request);
  if (
    contentType !== undefined &&
    contentType.toLowerCase().includes("application/json")
  ) {
    return true;
  }

  const bodyText = request.getBody()?.toText();
  if (bodyText === undefined) {
    return false;
  }

  if (bodyText.length > 1_000_000) {
    return false;
  }

  const trimmed = bodyText.trimStart();
  if (!trimmed.startsWith("{")) {
    return false;
  }

  const parsed = parseJsonValue(trimmed);
  return parsed.kind === "Ok" && isRecord(parsed.value);
};

const responseToText = (response: Response | undefined): string | undefined => {
  if (response === undefined) {
    return undefined;
  }
  return response.getBody()?.toText();
};

const truncateText = (
  text: string | undefined,
  max: number,
): string | undefined => {
  if (text === undefined) {
    return undefined;
  }
  if (text.length <= max) {
    return text;
  }
  return text.slice(0, max);
};

const formatHeaders = (headers: Record<string, Array<string>>): string => {
  const lines: Array<string> = [];
  for (const [name, values] of Object.entries(headers)) {
    for (const value of values) {
      lines.push(`${name}: ${value}`);
    }
  }
  return lines.join("\n");
};

const buildRequestPreview = async (
  sdk: SDK,
  requestId: string,
): Promise<Result<RequestPreview>> => {
  const trimmed = requestId.trim();
  if (trimmed.length === 0) {
    return { kind: "Error", error: "requestId is required" };
  }

  const saved = await sdk.requests.get(trimmed);
  if (saved === undefined) {
    return { kind: "Error", error: `request ${trimmed} not found` };
  }

  const request = saved.request;
  const requestBody = truncateText(request.getBody()?.toText(), 200_000);
  const requestText = [
    `${request.getMethod()} ${request.getUrl()}`,
    formatHeaders(request.getHeaders()),
    "",
    requestBody ?? "",
  ].join("\n");

  const response = saved.response;
  if (response === undefined) {
    return {
      kind: "Ok",
      value: { requestId: trimmed, requestText, responseText: undefined },
    };
  }

  const responseBody = truncateText(response.getBody()?.toText(), 200_000);
  const responseText = [
    `HTTP ${response.getCode()}`,
    formatHeaders(response.getHeaders()),
    "",
    responseBody ?? "",
  ].join("\n");

  return {
    kind: "Ok",
    value: { requestId: trimmed, requestText, responseText },
  };
};

const sleep = (ms: number): void => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    Date.now();
  }
};

const containsKeyDeep = (value: JSONValue, key: string): boolean => {
  const stack: Array<JSONValue> = [value];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      continue;
    }

    if (Array.isArray(current)) {
      for (const item of current) {
        stack.push(item);
      }
      continue;
    }

    if (!isRecord(current)) {
      continue;
    }

    if (key in current) {
      return true;
    }

    for (const child of Object.values(current)) {
      stack.push(child);
    }
  }

  return false;
};

const getPrimitiveDeep = (
  value: JSONValue,
  key: string,
): JSONValue | undefined => {
  if (key.includes(".")) {
    const parts = key.split(".");
    let current: JSONValue = value;
    for (const part of parts) {
      if (isRecord(current) && part in current) {
        current = current[part];
      } else {
        return undefined;
      }
    }
    if (
      typeof current === "string" ||
      typeof current === "number" ||
      typeof current === "boolean" ||
      current === null
    ) {
      return current;
    }
    return undefined;
  }

  const stack: Array<JSONValue> = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      continue;
    }

    if (Array.isArray(current)) {
      for (const item of current) {
        stack.push(item);
      }
      continue;
    }

    if (!isRecord(current)) {
      continue;
    }

    if (key in current) {
      const v = current[key];
      if (
        typeof v === "string" ||
        typeof v === "number" ||
        typeof v === "boolean" ||
        v === null
      ) {
        return v;
      }
    }

    for (const child of Object.values(current)) {
      stack.push(child);
    }
  }

  return undefined;
};

const getAllPrimitives = (
  value: JSONValue,
  prefix = "",
): Record<string, string> => {
  const result: Record<string, string> = {};

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      Object.assign(result, getAllPrimitives(value[i], `${prefix}[${i}]`));
    }
  } else if (isRecord(value)) {
    for (const [key, val] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (
        typeof val === "string" ||
        typeof val === "number" ||
        typeof val === "boolean" ||
        val === null
      ) {
        result[path] = String(val);
      } else {
        Object.assign(result, getAllPrimitives(val, path));
      }
    }
  }

  return result;
};

const setDeep = (
  obj: JSONObject,
  path: string,
  value: JSONValue,
): JSONObject => {
  const parts = path.split(".");
  const result = { ...obj };
  let current: JSONObject = result;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (part === undefined) {
      continue;
    }

    const next = current[part];
    if (!(part in current) || !isRecord(next)) {
      current[part] = {};
    } else {
      current[part] = { ...next };
    }
    current = current[part];
  }

  const lastPart = parts[parts.length - 1];
  if (lastPart !== undefined) {
    current[lastPart] = value;
  }
  return result;
};

const buildMutations = (
  original: JSONObject,
  maxMutations: number,
  config: ScanConfig,
): Array<Mutation> => {
  const builtInCandidates = [
    "isAdmin",
    "admin",
    "is_staff",
    "isStaff",
    "isSuperuser",
    "role",
    "roles",
    "permissions",
    "tier",
    "plan",
  ];

  const rawCandidates: Array<string> = [];
  if (config.includeBuiltInCandidates) {
    rawCandidates.push(...builtInCandidates);
  }
  rawCandidates.push(...config.candidateFields);

  const candidates: Array<string> = [];
  const seen = new Set<string>();
  for (const raw of rawCandidates) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    candidates.push(trimmed);
  }

  const values: Array<JSONPrimitive> = [];
  if (config.valueModes.booleanTrue) {
    values.push(true);
  }
  if (config.valueModes.stringAdmin) {
    values.push("admin");
  }
  if (config.valueModes.numberOne) {
    values.push(1);
  }
  const valueCandidates: Array<ValueCandidate> = values.map((value) => ({
    kind: "Fixed",
    value,
  }));

  if (config.valueModes.numberPlusOne) {
    valueCandidates.push({ kind: "NumericDelta", delta: 1 });
  }
  if (config.valueModes.numberMinusOne) {
    valueCandidates.push({ kind: "NumericDelta", delta: -1 });
  }

  for (const custom of config.customValues) {
    const trimmed = custom.trim();
    if (trimmed.length === 0) {
      continue;
    }

    let value: JSONValue = trimmed;
    if (trimmed === "true") {
      value = true;
    } else if (trimmed === "false") {
      value = false;
    } else if (trimmed === "null") {
      value = undefined;
    } else if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      const num = Number(trimmed);
      if (Number.isFinite(num)) {
        value = num;
      }
    } else if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      const parsed = parseJsonValue(trimmed);
      if (parsed.kind === "Ok") {
        value = parsed.value;
      }
    }

    valueCandidates.push({ kind: "Fixed", value });
  }

  if (valueCandidates.length === 0) {
    valueCandidates.push({ kind: "Fixed", value: true });
  }

  const mutations: Array<Mutation> = [];

  for (const field of candidates) {
    if (mutations.length >= maxMutations) {
      break;
    }

    if (!config.mutateExistingFields && field in original) {
      continue;
    }

    const existingValue = original[field];

    for (const candidate of valueCandidates) {
      if (mutations.length >= maxMutations) {
        break;
      }

      const value: JSONValue | undefined =
        candidate.kind === "Fixed"
          ? candidate.value
          : typeof existingValue === "number"
            ? existingValue + candidate.delta
            : typeof existingValue === "string" &&
                /^[0-9]+$/.test(existingValue)
              ? String(Number(existingValue) + candidate.delta)
              : undefined;

      if (value === undefined) {
        continue;
      }

      if (typeof value === "number" && !Number.isFinite(value)) {
        continue;
      }

      if (
        config.mutateExistingFields &&
        (typeof existingValue === "string" ||
          typeof existingValue === "number" ||
          typeof existingValue === "boolean") &&
        safeStringify(existingValue) === safeStringify(value)
      ) {
        continue;
      }

      const mutated = setDeep(original, field, value);
      mutations.push({
        field,
        value,
        bodyText: JSON.stringify(mutated),
      });
    }
  }

  return mutations;
};

const makeFinding = (params: {
  requestId: string;
  field: string;
  value: JSONValue;
  kind: ScanFinding["kind"];
  baselineResponse: Response | undefined;
  mutatedResponse: Response | undefined;
  persistedResponse: Response | undefined;
  mutatedRequestId: string | undefined;
  persistedRequestId: string | undefined;
  verifyBaselineRequestId?: string;
  verifyRequestId?: string;
  baselineBodySnippet: string | undefined;
  mutatedBodySnippet: string | undefined;
  persistedBodySnippet: string | undefined;
  details: string;
}): ScanFinding => {
  const baselineCode = params.baselineResponse?.getCode();
  const mutatedCode = params.mutatedResponse?.getCode();
  const persistedCode = params.persistedResponse?.getCode();

  return {
    id: `${params.requestId}:${params.kind}:${params.field}:${safeStringify(params.value)}`,
    requestId: params.requestId,
    field: params.field,
    value: safeStringify(params.value),
    kind: params.kind,
    baselineCode,
    mutatedCode,
    persistedCode,
    mutatedRequestId: params.mutatedRequestId,
    persistedRequestId: params.persistedRequestId,
    verifyBaselineRequestId: params.verifyBaselineRequestId,
    verifyRequestId: params.verifyRequestId,
    baselineBodySnippet: params.baselineBodySnippet,
    mutatedBodySnippet: params.mutatedBodySnippet,
    persistedBodySnippet: params.persistedBodySnippet,
    message: `${params.field}=${safeStringify(params.value)} — ${params.details}`,
  };
};

const headersToPairs = (
  headers: Record<string, Array<string>>,
): Array<[string, string]> => {
  const pairs: Array<[string, string]> = [];
  for (const [name, values] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (
      lower === "content-length" ||
      lower === "transfer-encoding" ||
      lower === "host"
    ) {
      continue;
    }
    for (const value of values) {
      pairs.push([name, value]);
    }
  }
  return pairs;
};

const resolveUrl = (input: string, baseUrl: string): Result<string> => {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { kind: "Error", error: "verification url is required" };
  }

  const fullUrl = trimmed.match(/^https?:\/\/\S+$/i);
  if (fullUrl !== null) {
    return { kind: "Ok", value: trimmed };
  }

  const baseMatch = baseUrl.match(/^(https?):\/\/([^/?#]+)(?:[/?#]|$)/i);
  if (baseMatch === null) {
    return { kind: "Error", error: "baseline url is invalid" };
  }

  const scheme = baseMatch[1];
  const hostPort = baseMatch[2];
  if (scheme === undefined || hostPort === undefined) {
    return { kind: "Error", error: "baseline url is invalid" };
  }

  const origin = `${scheme}://${hostPort}`;
  const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return { kind: "Ok", value: `${origin}${path}` };
};

const parseRawRequestSpec = (
  input: SaveRawRequestInput,
): Result<RequestSpec> => {
  const host = input.host.trim();
  if (host.length === 0) {
    return { kind: "Error", error: "host is required" };
  }
  if (input.port < 1 || input.port > 65535) {
    return { kind: "Error", error: "port is invalid" };
  }

  const rawNormalized = input.raw.replace(/\r\n/g, "\n");
  const splitIdx = rawNormalized.indexOf("\n\n");
  const headerBlock =
    splitIdx === -1 ? rawNormalized : rawNormalized.slice(0, splitIdx);
  const bodyText = splitIdx === -1 ? "" : rawNormalized.slice(splitIdx + 2);

  const headerLines = headerBlock
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  const requestLine = headerLines[0];
  if (requestLine === undefined) {
    return { kind: "Error", error: "request is empty" };
  }

  const parts = requestLine.split(/\s+/);
  const methodRaw = parts[0];
  const targetRaw = parts[1];
  if (methodRaw === undefined || targetRaw === undefined) {
    return { kind: "Error", error: "invalid request line" };
  }

  const scheme = input.isTls ? "https" : "http";
  const base = `${scheme}://${host}:${input.port}`;
  const url =
    targetRaw.startsWith("http://") || targetRaw.startsWith("https://")
      ? targetRaw
      : targetRaw.startsWith("/")
        ? `${base}${targetRaw}`
        : `${base}/${targetRaw}`;

  const headerPairs: Array<[string, string]> = [];
  let currentName: string | undefined = undefined;
  let currentValue = "";
  const flush = () => {
    if (currentName === undefined) {
      return;
    }
    const nameLower = currentName.toLowerCase();
    if (nameLower !== "content-length" && nameLower !== "transfer-encoding") {
      headerPairs.push([currentName, currentValue]);
    }
    currentName = undefined;
    currentValue = "";
  };

  for (const line of headerLines.slice(1)) {
    if (line.startsWith(" ") || line.startsWith("\t")) {
      if (currentName !== undefined) {
        currentValue = `${currentValue} ${line.trim()}`.trim();
      }
      continue;
    }

    flush();
    const idx = line.indexOf(":");
    if (idx <= 0) {
      continue;
    }
    const name = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (name.length === 0) {
      continue;
    }
    currentName = name;
    currentValue = value;
  }
  flush();

  const spec = new RequestSpec(url);
  spec.setMethod(methodRaw.trim());
  for (const [name, value] of headerPairs) {
    spec.setHeader(name, value);
  }
  spec.setBody(bodyText);
  return { kind: "Ok", value: spec };
};

const saveRequestFromRaw = async (
  sdk: SDK,
  input: SaveRawRequestInput,
): Promise<Result<RequestSummary>> => {
  const rawTrimmed = input.raw.trim();
  if (rawTrimmed.length === 0) {
    return { kind: "Error", error: "raw request is empty" };
  }

  const specParsed = parseRawRequestSpec({ ...input, raw: rawTrimmed });
  if (specParsed.kind === "Error") {
    return specParsed;
  }

  let sent;
  try {
    sent = await sdk.requests.send(specParsed.value);
  } catch {
    return { kind: "Error", error: "failed to send request" };
  }

  return {
    kind: "Ok",
    value: {
      id: String(sent.request.getId()),
      method: sent.request.getMethod(),
      url: sent.request.getUrl(),
      createdAt: sent.request.getCreatedAt().toISOString(),
      hasResponse: sent.response !== undefined,
    },
  };
};

const runScan = async (
  sdk: SDK,
  target: ScanTarget,
  config: ScanConfig,
): Promise<Result<ScanResult>> => {
  shouldStopScan = false;
  if (config.maxMutations < 1) {
    return {
      kind: "Error",
      error: "maxMutations must be >= 1",
    };
  }

  if (config.maxMutations > 256) {
    return {
      kind: "Error",
      error: "maxMutations must be <= 256",
    };
  }

  if (config.persistenceDelayMs < 0) {
    return { kind: "Error", error: "persistenceDelayMs must be >= 0" };
  }

  if (config.persistenceDelayMs > 10_000) {
    return { kind: "Error", error: "persistenceDelayMs must be <= 10000" };
  }

  if (config.candidateFields.length > 5000) {
    return { kind: "Error", error: "candidateFields is too large" };
  }

  if (config.verification.kind === "FollowUp") {
    if (config.verification.delayMs < 0) {
      return { kind: "Error", error: "verification.delayMs must be >= 0" };
    }
    if (config.verification.delayMs > 10_000) {
      return { kind: "Error", error: "verification.delayMs must be <= 10000" };
    }
  }

  const applyHeaders = (
    spec: RequestSpec,
    headers: Array<[string, string]>,
  ) => {
    for (const [name, value] of headers) {
      spec.setHeader(name, value);
    }
  };

  const trimmedRequestId = target.requestId.trim();
  if (trimmedRequestId.length === 0) {
    return { kind: "Error", error: "requestId is required" };
  }

  const saved = await sdk.requests.get(trimmedRequestId);
  if (saved === undefined) {
    return { kind: "Error", error: `request ${trimmedRequestId} not found` };
  }

  const request = saved.request;
  const baseUrl = request.getUrl();
  const baseHeaderPairs = headersToPairs(request.getHeaders());

  if (!isJsonRequest(request)) {
    return {
      kind: "Error",
      error: "request Content-Type is not application/json",
    };
  }

  const bodyText = request.getBody()?.toText();
  if (bodyText === undefined) {
    return { kind: "Error", error: "request body is empty" };
  }

  const parsed = parseJsonValue(bodyText);
  if (parsed.kind === "Error") {
    return parsed;
  }

  if (!isRecord(parsed.value)) {
    return { kind: "Error", error: "request JSON body must be an object" };
  }

  const originalJson = parsed.value;
  const originalBodyText = bodyText;
  const baselineRequestId = trimmedRequestId;
  let baselineResponse = saved.response;

  const makeSpec = (params: { bodyText: string; marker: string }) => {
    const spec = request.toSpec();
    spec.setBody(params.bodyText);
    spec.setHeader(PluginMarkerHeader, params.marker);
    return spec;
  };

  if (baselineResponse === undefined) {
    try {
      sdk.console.log(`Sending baseline request for ${baselineRequestId}`);
      const spec = makeSpec({
        bodyText: originalBodyText,
        marker: "baseline",
      });
      baselineResponse = (await sdk.requests.send(spec)).response;
    } catch {
      sdk.console.log(
        `Failed to send baseline request for ${baselineRequestId}`,
      );
      return { kind: "Error", error: "failed to send baseline request" };
    }
  }

  const baselineText = responseToText(baselineResponse);
  const baselineBodySnippet = truncateText(baselineText, 4000);
  const baselineJson =
    baselineText === undefined ? undefined : parseJsonValue(baselineText);

  let verifyBaselineResponse: Response | undefined = undefined;
  let verifyBaselineJson: JSONObject | undefined = undefined;
  let verifyBaselineRequestId: string | undefined = undefined;
  let verifyUrlResolved: string | undefined = undefined;
  let verifyBaselineBodySnippet: string | undefined = undefined;

  if (config.verification.kind === "FollowUp") {
    const resolved = resolveUrl(config.verification.url, baseUrl);
    if (resolved.kind === "Error") {
      return resolved;
    }
    verifyUrlResolved = resolved.value;

    const verifySpec = new RequestSpec(verifyUrlResolved);
    verifySpec.setMethod(config.verification.method || "GET");
    applyHeaders(verifySpec, baseHeaderPairs);
    verifySpec.setHeader(PluginMarkerHeader, "verify-baseline");
    verifySpec.setBody(config.verification.body || "");

    let verifySent;
    try {
      sdk.console.log(
        `Sending verification baseline request to ${verifyUrlResolved}`,
      );
      verifySent = await sdk.requests.send(verifySpec);
    } catch {
      sdk.console.log(
        `Failed to send verification request to ${verifyUrlResolved}`,
      );
      return { kind: "Error", error: "failed to send verification request" };
    }

    verifyBaselineRequestId = String(verifySent.request.getId());
    verifyBaselineResponse = verifySent.response;
    if (verifyBaselineResponse === undefined) {
      return { kind: "Error", error: "verification request has no response" };
    }

    const verifyText = responseToText(verifyBaselineResponse);
    verifyBaselineBodySnippet = truncateText(verifyText, 4000);

    if (verifyText !== undefined) {
      const parsed = parseJsonValue(verifyText);
      if (parsed.kind === "Ok" && isRecord(parsed.value)) {
        verifyBaselineJson = parsed.value;
      }
    }
  }

  const mutations = buildMutations(originalJson, config.maxMutations, config);
  if (mutations.length === 0) {
    return {
      kind: "Error",
      error:
        "no mutations generated (all candidate fields already exist in request body)",
    };
  }
  const findings: Array<ScanFinding> = [];

  sdk.console.log(
    `Mass Assignment Radar scan for request ${baselineRequestId} with ${mutations.length} mutations`,
  );

  const baselineHadKey = (field: string): boolean => {
    return (
      baselineJson !== undefined &&
      baselineJson.kind === "Ok" &&
      containsKeyDeep(baselineJson.value, field)
    );
  };

  for (const mutation of mutations) {
    if (shouldStopScan) {
      sdk.console.log("Scan stopped by user");
      break;
    }
    sdk.console.log(
      `Testing mutation: ${mutation.field}=${safeStringify(mutation.value)}`,
    );
    const spec = makeSpec({ bodyText: mutation.bodyText, marker: "mutated" });

    let sent;
    try {
      sent = await sdk.requests.send(spec);
    } catch {
      findings.push(
        makeFinding({
          requestId: baselineRequestId,
          field: mutation.field,
          value: mutation.value,
          kind: "NoResponse",
          baselineResponse,
          mutatedResponse: undefined,
          persistedResponse: undefined,
          mutatedRequestId: undefined,
          persistedRequestId: undefined,
          baselineBodySnippet,
          mutatedBodySnippet: undefined,
          persistedBodySnippet: undefined,
          details: "failed to send request",
        }),
      );
      continue;
    }

    const mutatedResponse = sent.response;
    const mutatedRequestId = String(sent.request.getId());

    const baselineCode = baselineResponse?.getCode();
    const mutatedCode = mutatedResponse.getCode();

    if (baselineCode !== undefined && mutatedCode !== baselineCode) {
      sdk.console.log(
        `[!] Finding: CodeChanged for ${mutation.field} (${baselineCode} -> ${mutatedCode})`,
      );
      findings.push(
        makeFinding({
          requestId: baselineRequestId,
          field: mutation.field,
          value: mutation.value,
          kind: "CodeChanged",
          baselineResponse,
          mutatedResponse,
          persistedResponse: undefined,
          mutatedRequestId,
          persistedRequestId: undefined,
          baselineBodySnippet,
          mutatedBodySnippet: undefined,
          persistedBodySnippet: undefined,
          details: `status code changed ${baselineCode} -> ${mutatedCode}`,
        }),
      );
    }

    if (
      config.verification.kind === "FollowUp" &&
      verifyBaselineJson !== undefined &&
      verifyUrlResolved !== undefined &&
      verifyBaselineRequestId !== undefined
    ) {
      if (config.verification.delayMs > 0) {
        sleep(config.verification.delayMs);
      }

      const verifySpec = new RequestSpec(verifyUrlResolved);
      verifySpec.setMethod(config.verification.method || "GET");
      applyHeaders(verifySpec, baseHeaderPairs);
      verifySpec.setHeader(PluginMarkerHeader, "verify-mutated");
      verifySpec.setBody(config.verification.body || "");

      let verifySent;
      try {
        verifySent = await sdk.requests.send(verifySpec);
      } catch {
        verifySent = undefined;
      }

      if (verifySent !== undefined && verifySent.response !== undefined) {
        const verifyText = responseToText(verifySent.response);
        if (verifyText !== undefined) {
          const parsed = parseJsonValue(verifyText);
          if (parsed.kind === "Ok" && isRecord(parsed.value)) {
            const baselinePrimitives = getAllPrimitives(verifyBaselineJson);
            const mutatedPrimitives = getAllPrimitives(parsed.value);

            const changed: Array<string> = [];
            const noisyKeys = [
              "id",
              "createdAt",
              "updatedAt",
              "timestamp",
              "time",
              "iat",
              "exp",
              "nonce",
              "imageUrl",
            ];

            for (const [path, val] of Object.entries(mutatedPrimitives)) {
              const baselineVal = baselinePrimitives[path];
              if (baselineVal !== undefined && baselineVal !== val) {
                const isNoisy = noisyKeys.some(
                  (k) => path === k || path.endsWith(`.${k}`),
                );
                if (!isNoisy) {
                  changed.push(`${path}: ${baselineVal} -> ${val}`);
                }
              }
            }

            if (changed.length > 0) {
              sdk.console.log(
                `[!] Finding: StateChanged for ${mutation.field} (Changes: ${changed.join(", ")})`,
              );
              findings.push(
                makeFinding({
                  requestId: baselineRequestId,
                  field: mutation.field,
                  value: mutation.value,
                  kind: "StateChanged",
                  baselineResponse: verifyBaselineResponse,
                  mutatedResponse: verifySent.response,
                  persistedResponse: undefined,
                  mutatedRequestId,
                  persistedRequestId: undefined,
                  verifyBaselineRequestId,
                  verifyRequestId: String(verifySent.request.getId()),
                  baselineBodySnippet: verifyBaselineBodySnippet,
                  mutatedBodySnippet: truncateText(verifyText, 4000),
                  persistedBodySnippet: undefined,
                  details: `state changed via follow-up (${changed.join(", ")})`,
                }),
              );
            }
          }
        }
      }
    }

    const mutatedText = responseToText(mutatedResponse);
    const mutatedBodySnippet = truncateText(mutatedText, 4000);
    if (mutatedText === undefined) {
      continue;
    }

    const mutatedJsonParsed = parseJsonValue(mutatedText);
    if (mutatedJsonParsed.kind === "Error") {
      findings.push(
        makeFinding({
          requestId: baselineRequestId,
          field: mutation.field,
          value: mutation.value,
          kind: "NonJsonResponse",
          baselineResponse,
          mutatedResponse,
          persistedResponse: undefined,
          mutatedRequestId,
          persistedRequestId: undefined,
          baselineBodySnippet,
          mutatedBodySnippet,
          persistedBodySnippet: undefined,
          details: "response is not JSON",
        }),
      );
      continue;
    }

    const mutatedTop = getPrimitiveDeep(
      mutatedJsonParsed.value,
      mutation.field,
    );
    const baselineTop =
      baselineJson !== undefined && baselineJson.kind === "Ok"
        ? getPrimitiveDeep(baselineJson.value, mutation.field)
        : undefined;

    if (
      mutatedTop !== undefined &&
      safeStringify(mutatedTop) === safeStringify(mutation.value)
    ) {
      const isNewKey = !baselineHadKey(mutation.field);
      const valueChanged =
        baselineTop === undefined ||
        safeStringify(baselineTop) !== safeStringify(mutation.value);
      findings.push(
        makeFinding({
          requestId: baselineRequestId,
          field: mutation.field,
          value: mutation.value,
          kind: "Reflected",
          baselineResponse,
          mutatedResponse,
          persistedResponse: undefined,
          mutatedRequestId,
          persistedRequestId: undefined,
          baselineBodySnippet,
          mutatedBodySnippet,
          persistedBodySnippet: undefined,
          details: isNewKey
            ? "response contains injected key"
            : valueChanged
              ? "response contains overridden value"
              : "response echoed injected value",
        }),
      );

      if (config.confirmPersistence) {
        if (config.persistenceDelayMs > 0) {
          sleep(config.persistenceDelayMs);
        }

        let persistedSent;
        try {
          const spec = makeSpec({
            bodyText: originalBodyText,
            marker: "persisted",
          });
          persistedSent = await sdk.requests.send(spec);
        } catch {
          continue;
        }

        const persistedResponse = persistedSent.response;
        const persistedRequestId = String(persistedSent.request.getId());
        const persistedText = responseToText(persistedResponse);
        const persistedBodySnippet = truncateText(persistedText, 4000);
        if (persistedText === undefined) {
          continue;
        }

        const persistedJsonParsed = parseJsonValue(persistedText);
        if (persistedJsonParsed.kind === "Error") {
          continue;
        }

        const persistedTop = getPrimitiveDeep(
          persistedJsonParsed.value,
          mutation.field,
        );
        if (
          persistedTop !== undefined &&
          safeStringify(persistedTop) === safeStringify(mutation.value)
        ) {
          findings.push(
            makeFinding({
              requestId: baselineRequestId,
              field: mutation.field,
              value: mutation.value,
              kind: "Persisted",
              baselineResponse,
              mutatedResponse,
              persistedResponse,
              mutatedRequestId,
              persistedRequestId,
              baselineBodySnippet,
              mutatedBodySnippet,
              persistedBodySnippet,
              details: "injected value present after baseline replay",
            }),
          );
        }
      }
    }
  }

  return {
    kind: "Ok",
    value: {
      baselineRequestId,
      findings,
    },
  };
};

const createFindings = async (
  sdk: SDK,
  input: CreateFindingsInput,
): Promise<Result<CreateFindingsResult>> => {
  const trimmedRequestId = input.requestId.trim();
  if (trimmedRequestId.length === 0) {
    return { kind: "Error", error: "requestId is required" };
  }

  if (input.findings.length === 0) {
    return { kind: "Error", error: "findings is empty" };
  }

  if (input.findings.length > 200) {
    return { kind: "Error", error: "too many findings" };
  }

  const saved = await sdk.requests.get(trimmedRequestId);
  if (saved === undefined) {
    return { kind: "Error", error: `request ${trimmedRequestId} not found` };
  }

  let created = 0;

  try {
    for (const finding of input.findings) {
      const title = `Mass Assignment Radar: ${finding.kind} ${finding.field}`;
      const lines: Array<string> = [
        finding.message,
        `Baseline ID: ${trimmedRequestId}`,
        `Value: ${finding.value}`,
      ];
      if (finding.mutatedRequestId !== undefined) {
        lines.push(`Mutated ID: ${finding.mutatedRequestId}`);
      }
      if (finding.persistedRequestId !== undefined) {
        lines.push(`Persisted ID: ${finding.persistedRequestId}`);
      }
      const description = lines.join("\n");

      const dedupeKey =
        `${trimmedRequestId}:${finding.kind}:${finding.field}` as DedupeKey;

      let requestToAttach = saved.request;
      if (
        finding.kind === "StateChanged" &&
        finding.verifyRequestId !== undefined
      ) {
        const verifiedSaved = await sdk.requests.get(finding.verifyRequestId);
        if (verifiedSaved !== undefined) {
          requestToAttach = verifiedSaved.request;
        }
      } else if (
        finding.kind === "Persisted" &&
        finding.persistedRequestId !== undefined
      ) {
        const persistedSaved = await sdk.requests.get(
          finding.persistedRequestId,
        );
        if (persistedSaved !== undefined) {
          requestToAttach = persistedSaved.request;
        }
      } else if (finding.mutatedRequestId !== undefined) {
        const mutatedSaved = await sdk.requests.get(finding.mutatedRequestId);
        if (mutatedSaved !== undefined) {
          requestToAttach = mutatedSaved.request;
        }
      }

      await sdk.findings.create({
        title,
        description,
        reporter: "Mass Assignment Radar",
        dedupeKey,
        request: requestToAttach,
      });

      created += 1;
    }
  } catch (error) {
    return {
      kind: "Error",
      error: `failed to create findings: ${String(error)}`,
    };
  }

  return { kind: "Ok", value: { created } };
};

const listJsonRequests = async (
  sdk: SDK,
  filter: string,
  limit: number,
): Promise<Result<Array<RequestSummary>>> => {
  if (limit < 1) {
    return { kind: "Error", error: "limit must be >= 1" };
  }

  if (limit > 5000) {
    return { kind: "Error", error: "limit must be <= 5000" };
  }

  let query = sdk.requests.query().descending("req", "created_at");

  const trimmedFilter = filter.trim();
  if (trimmedFilter.length > 0) {
    query = query.filter(trimmedFilter);
  }

  let results;
  try {
    results = await query.execute();
  } catch (error) {
    return {
      kind: "Error",
      error: `failed to execute query: ${String(error)}`,
    };
  }

  const items = results.items
    .map((item): RequestSummary | undefined => {
      const request = item.request;
      if (isPluginGeneratedRequest(request)) {
        return undefined;
      }
      if (!isJsonRequest(request)) {
        return undefined;
      }

      return {
        id: String(request.getId()),
        method: request.getMethod(),
        url: request.getUrl(),
        createdAt: request.getCreatedAt().toISOString(),
        hasResponse: item.response !== undefined,
      };
    })
    .filter((item): item is RequestSummary => item !== undefined)
    .slice(0, limit);

  return { kind: "Ok", value: items };
};

const getRequestSummary = async (
  sdk: SDK,
  requestId: string,
): Promise<Result<RequestSummary>> => {
  const trimmed = requestId.trim();
  if (trimmed.length === 0) {
    return { kind: "Error", error: "requestId is required" };
  }

  const saved = await sdk.requests.get(trimmed);
  if (saved === undefined) {
    return { kind: "Error", error: `request ${trimmed} not found` };
  }

  const request = saved.request;

  return {
    kind: "Ok",
    value: {
      id: String(request.getId()),
      method: request.getMethod(),
      url: request.getUrl(),
      createdAt: request.getCreatedAt().toISOString(),
      hasResponse: saved.response !== undefined,
    },
  };
};

export type API = DefineAPI<{
  runScan: typeof runScan;
  stopScan: typeof stopScan;
  listJsonRequests: typeof listJsonRequests;
  createFindings: typeof createFindings;
  getRequestPreview: typeof buildRequestPreview;
  getRequestSummary: typeof getRequestSummary;
  saveRequestFromRaw: typeof saveRequestFromRaw;
}>;

export function init(sdk: SDK<API>) {
  sdk.api.register("runScan", runScan);
  sdk.api.register("stopScan", stopScan);
  sdk.api.register("listJsonRequests", listJsonRequests);
  sdk.api.register("createFindings", createFindings);
  sdk.api.register("getRequestPreview", buildRequestPreview);
  sdk.api.register("getRequestSummary", getRequestSummary);
  sdk.api.register("saveRequestFromRaw", saveRequestFromRaw);
}
