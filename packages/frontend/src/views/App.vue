<script setup lang="ts">
import type {
  RequestPreview,
  RequestSummary,
  Result,
  ScanConfig,
  ScanFinding,
  ScanResult,
} from "backend";
import Button from "primevue/button";
import Card from "primevue/card";
import Checkbox from "primevue/checkbox";
import Column from "primevue/column";
import DataTable from "primevue/datatable";
import Dialog from "primevue/dialog";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import Splitter from "primevue/splitter";
import SplitterPanel from "primevue/splitterpanel";
import Textarea from "primevue/textarea";
import { computed, onMounted, ref, watch } from "vue";

import logo from "@/assets/mass-assignment-radar/logo.svg";
import { useSDK } from "@/plugins/sdk";

const sdk = useSDK();

const requestId = ref("");
const ignoreNextRequestIdReset = ref(false);
const maxMutations = ref(16);
const includeBuiltInCandidates = ref(true);
const candidateFieldsText = ref("");
const customValuesText = ref("");
const mutateExistingFields = ref(false);
const valueModeBooleanTrue = ref(true);
const valueModeStringAdmin = ref(true);
const valueModeNumberOne = ref(true);
const valueModeNumberPlusOne = ref(false);
const valueModeNumberMinusOne = ref(false);
const confirmPersistence = ref(false);
const persistenceDelayMs = ref(500);
const verificationEnabled = ref(false);
const verificationUrl = ref("");
const verificationMethod = ref("GET");
const verificationMethods = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];
const verificationBody = ref("");
const verificationDelayMs = ref(0);

const isScanning = ref(false);
const findings = ref<Array<ScanFinding>>([]);
const selectedFindings = ref<Array<ScanFinding>>([]);
const errorMessage = ref<string | undefined>(undefined);
const kindFilter = ref<Record<ScanFinding["kind"], boolean>>({
  Reflected: true,
  Persisted: true,
  CodeChanged: true,
  StateChanged: true,
  NonJsonResponse: true,
  NoResponse: true,
});
const logoUrl = logo;
const logoFailed = ref(false);

const requestsFilter = ref("");
const requestsLimit = ref(200);
const isLoadingRequests = ref(false);
const pinnedRequests = ref<Array<RequestSummary>>([]);
const requests = ref<Array<RequestSummary>>([]);
const selectedRequest = ref<RequestSummary | undefined>(undefined);

const isPreviewOpen = ref(false);
const previewTitle = ref("");
const previewRequestText = ref("");
const previewResponseText = ref<string | undefined>(undefined);
const previewRequestId = ref("");

const isDetailsOpen = ref(false);
const detailsTitle = ref("");
const detailsMessage = ref("");

type IncomingRequest = {
  id: string;
  host: string;
  port: number;
  path: string;
  query: string;
  isTls: boolean;
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const parseIncomingRequest = (value: unknown): IncomingRequest | undefined => {
  if (!isPlainRecord(value)) {
    return undefined;
  }
  const raw = value["incomingRequest"];
  if (!isPlainRecord(raw)) {
    return undefined;
  }
  const idRaw = raw["id"];
  const id =
    typeof idRaw === "string"
      ? idRaw
      : typeof idRaw === "number"
        ? String(idRaw)
        : undefined;
  if (id === undefined) {
    return undefined;
  }
  const host = raw["host"];
  const port = raw["port"];
  const path = raw["path"];
  const query = raw["query"];
  const isTls = raw["isTls"];
  if (
    typeof host !== "string" ||
    typeof port !== "number" ||
    typeof path !== "string" ||
    typeof query !== "string" ||
    typeof isTls !== "boolean"
  ) {
    return undefined;
  }
  return { id, host, port, path, query, isTls };
};

const parseIncomingRequestId = (value: unknown): string | undefined => {
  if (!isPlainRecord(value)) {
    return undefined;
  }
  const raw = value["incomingRequestId"];
  if (typeof raw === "string") {
    return raw;
  }
  if (typeof raw === "number") {
    return String(raw);
  }
  return undefined;
};

const buildIncomingUrl = (incoming: IncomingRequest): string => {
  const scheme = incoming.isTls ? "https" : "http";
  const query = incoming.query.trim();
  const normalizedQuery =
    query.length === 0 ? "" : query.startsWith("?") ? query : `?${query}`;
  return `${scheme}://${incoming.host}:${incoming.port}${incoming.path}${normalizedQuery}`;
};

const upsertPinnedRequest = (summary: RequestSummary) => {
  pinnedRequests.value = [
    summary,
    ...pinnedRequests.value.filter((r) => r.id !== summary.id),
  ];
};

const acceptIncomingRequest = async (incoming: IncomingRequest) => {
  const normalized = incoming.id.trim();
  if (normalized.length === 0) {
    return;
  }
  requestId.value = normalized;
  selectedRequest.value = undefined;
  const result: Result<RequestSummary> =
    await sdk.backend.getRequestSummary(normalized);
  if (result.kind === "Ok") {
    upsertPinnedRequest(result.value);
  } else {
    upsertPinnedRequest({
      id: normalized,
      method: "—",
      url: buildIncomingUrl(incoming),
      createdAt: new Date().toISOString(),
      hasResponse: false,
    });
  }
  await sdk.storage.set({
    incomingRequest: undefined,
    incomingRequestId: undefined,
    incomingRawRequest: undefined,
  });
};

const acceptIncomingRequestId = async (incoming: string) => {
  const normalized = incoming.trim();
  if (normalized.length === 0) {
    return;
  }
  requestId.value = normalized;
  selectedRequest.value = undefined;
  await sdk.storage.set({
    incomingRequestId: undefined,
    incomingRawRequest: undefined,
  });
};

onMounted(() => {
  const storage = sdk.storage.get();
  const firstRequest = parseIncomingRequest(storage);
  if (firstRequest !== undefined) {
    void acceptIncomingRequest(firstRequest);
  } else {
    const firstId = parseIncomingRequestId(storage);
    if (firstId !== undefined) {
      void acceptIncomingRequestId(firstId);
    }
  }
  sdk.storage.onChange((value) => {
    const incomingRequest = parseIncomingRequest(value);
    if (incomingRequest !== undefined) {
      void acceptIncomingRequest(incomingRequest);
      return;
    }
    const incomingId = parseIncomingRequestId(value);
    if (incomingId !== undefined) {
      void acceptIncomingRequestId(incomingId);
    }
  });
});

const canRunScan = computed(() => requestId.value.trim().length > 0);

const canLoadRequests = computed(() => !isLoadingRequests.value);
const canClearRequests = computed(
  () =>
    !isLoadingRequests.value &&
    (pinnedRequests.value.length > 0 || requests.value.length > 0),
);

const displayedRequests = computed<Array<RequestSummary>>(() => {
  const seen = new Set<string>();
  const merged: Array<RequestSummary> = [];
  for (const item of [...pinnedRequests.value, ...requests.value]) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    merged.push(item);
  }
  return merged;
});

const parseCandidateFields = (text: string): Array<string> => {
  const parts = text
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const seen = new Set<string>();
  const result: Array<string> = [];
  for (const item of parts) {
    if (seen.has(item)) {
      continue;
    }
    seen.add(item);
    result.push(item);
  }
  return result;
};

const scanConfig = computed<ScanConfig>(() => {
  return {
    maxMutations: maxMutations.value,
    includeBuiltInCandidates: includeBuiltInCandidates.value,
    candidateFields: parseCandidateFields(candidateFieldsText.value),
    customValues: parseCandidateFields(customValuesText.value),
    mutateExistingFields: mutateExistingFields.value,
    valueModes: {
      booleanTrue: valueModeBooleanTrue.value,
      stringAdmin: valueModeStringAdmin.value,
      numberOne: valueModeNumberOne.value,
      numberPlusOne: valueModeNumberPlusOne.value,
      numberMinusOne: valueModeNumberMinusOne.value,
    },
    confirmPersistence: confirmPersistence.value,
    persistenceDelayMs: persistenceDelayMs.value,
    verification: verificationEnabled.value
      ? {
          kind: "FollowUp" as const,
          url: verificationUrl.value,
          method: verificationMethod.value,
          body: verificationBody.value,
          delayMs: verificationDelayMs.value,
        }
      : { kind: "Disabled" as const },
  };
});

const loadRequests = async () => {
  if (!canLoadRequests.value) {
    return;
  }
  isLoadingRequests.value = true;
  errorMessage.value = undefined;
  requests.value = [];
  selectedRequest.value = undefined;
  findings.value = [];
  selectedFindings.value = [];
  kindFilter.value = {
    Reflected: true,
    Persisted: true,
    CodeChanged: true,
    StateChanged: true,
    NonJsonResponse: true,
    NoResponse: true,
  };
  const result = await sdk.backend.listJsonRequests(
    requestsFilter.value,
    requestsLimit.value,
  );
  if (result.kind === "Error") {
    errorMessage.value = result.error;
    sdk.window.showToast(result.error, { variant: "error" });
    isLoadingRequests.value = false;
    return;
  }
  requests.value = result.value;
  sdk.window.showToast(`Loaded ${result.value.length} JSON requests`, {
    variant: "success",
  });
  isLoadingRequests.value = false;
};

const clearRequests = () => {
  pinnedRequests.value = [];
  requests.value = [];
  selectedRequest.value = undefined;
  errorMessage.value = undefined;
};

const useSelectedRequest = () => {
  if (selectedRequest.value === undefined) {
    return;
  }
  requestId.value = selectedRequest.value.id;
  findings.value = [];
  selectedFindings.value = [];
  kindFilter.value = {
    Reflected: true,
    Persisted: true,
    CodeChanged: true,
    StateChanged: true,
    NonJsonResponse: true,
    NoResponse: true,
  };
};

const runScan = async () => {
  if (isScanning.value) {
    await sdk.backend.stopScan();
    sdk.window.showToast("Stopping scan...", { variant: "info" });
    return;
  }

  if (!canRunScan.value) {
    return;
  }
  isScanning.value = true;
  errorMessage.value = undefined;
  findings.value = [];
  const target = {
    kind: "SavedRequest" as const,
    requestId: requestId.value.trim(),
  };
  const result: Result<ScanResult> = await sdk.backend.runScan(
    target,
    scanConfig.value,
  );
  if (result.kind === "Error") {
    errorMessage.value = result.error;
    sdk.window.showToast(result.error, { variant: "error" });
    isScanning.value = false;
    return;
  }
  findings.value = result.value.findings;
  if (result.value.baselineRequestId.trim().length > 0) {
    ignoreNextRequestIdReset.value = true;
    requestId.value = result.value.baselineRequestId;
  }
  selectedFindings.value = [];
  sdk.window.showToast(
    `Scan finished: ${result.value.findings.length} findings`,
    {
      variant: "success",
    },
  );
  isScanning.value = false;
};

const canExportFindings = computed(() => {
  return requestId.value.trim().length > 0 && selectedFindings.value.length > 0;
});

const filteredFindings = computed<Array<ScanFinding>>(() => {
  const filters = kindFilter.value;
  const allOn =
    filters.Reflected &&
    filters.Persisted &&
    filters.CodeChanged &&
    filters.StateChanged &&
    filters.NonJsonResponse &&
    filters.NoResponse;
  if (allOn) {
    return findings.value;
  }
  return findings.value.filter((f) => filters[f.kind]);
});

const setOnlyKind = (kind: ScanFinding["kind"]) => {
  kindFilter.value = {
    Reflected: false,
    Persisted: false,
    CodeChanged: false,
    StateChanged: false,
    NonJsonResponse: false,
    NoResponse: false,
  };
  kindFilter.value[kind] = true;
};

watch(selectedRequest, (newVal) => {
  if (newVal !== undefined) {
    useSelectedRequest();
  }
});

watch(requestId, () => {
  if (ignoreNextRequestIdReset.value) {
    ignoreNextRequestIdReset.value = false;
    return;
  }
  findings.value = [];
  selectedFindings.value = [];
  kindFilter.value = {
    Reflected: true,
    Persisted: true,
    CodeChanged: true,
    StateChanged: true,
    NonJsonResponse: true,
    NoResponse: true,
  };
});

const exportSelectedFindings = async () => {
  if (!canExportFindings.value) {
    return;
  }
  const payload = {
    requestId: requestId.value.trim(),
    findings: selectedFindings.value.map((f) => ({
      field: f.field,
      value: f.value,
      kind: f.kind,
      message: f.message,
      mutatedRequestId: f.mutatedRequestId,
      persistedRequestId: f.persistedRequestId,
      verifyRequestId: f.verifyRequestId,
    })),
  };
  const result: Result<{ created: number }> =
    await sdk.backend.createFindings(payload);
  if (result.kind === "Error") {
    errorMessage.value = result.error;
    sdk.window.showToast(result.error, { variant: "error" });
    return;
  }
  sdk.window.showToast(`Exported ${result.value.created} findings`, {
    variant: "success",
  });
};

const rowClass = (data: RequestSummary) => {
  return selectedRequest.value?.id === data.id ? "bg-surface-700" : "";
};

const openPreview = (title: string, preview: RequestPreview) => {
  previewTitle.value = title;
  previewRequestId.value = preview.requestId;
  previewRequestText.value = preview.requestText;
  previewResponseText.value = preview.responseText;
  isPreviewOpen.value = true;
};

const copyText = async (label: string, text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    sdk.window.showToast(`Copied ${label}`, { variant: "success" });
  } catch {
    sdk.window.showToast(`Failed to copy ${label}`, { variant: "error" });
  }
};

const copyId = async (id: string) => {
  await copyText("ID", id);
};

const openMutated = async (id: string | undefined) => {
  if (id === undefined) {
    return;
  }
  const result = await sdk.backend.getRequestPreview(id);
  if (result.kind === "Error") {
    sdk.window.showToast(result.error, { variant: "error" });
    await copyId(id);
    return;
  }
  openPreview(`Mutated request ${id}`, result.value);
};

const openPersisted = async (id: string | undefined) => {
  if (id === undefined) {
    return;
  }
  const result = await sdk.backend.getRequestPreview(id);
  if (result.kind === "Error") {
    sdk.window.showToast(result.error, { variant: "error" });
    await copyId(id);
    return;
  }
  openPreview(`Persisted request ${id}`, result.value);
};

const openVerify = async (id: string | undefined) => {
  if (id === undefined) {
    return;
  }
  const result = await sdk.backend.getRequestPreview(id);
  if (result.kind === "Error") {
    sdk.window.showToast(result.error, { variant: "error" });
    await copyId(id);
    return;
  }
  openPreview(`Verification request ${id}`, result.value);
};

const openDetails = (finding: ScanFinding) => {
  detailsTitle.value = `Finding Details: ${finding.field}`;
  detailsMessage.value = finding.message;
  isDetailsOpen.value = true;
};

const canExportAllFindings = computed(() => {
  return requestId.value.trim().length > 0 && filteredFindings.value.length > 0;
});

const exportAllFindings = async () => {
  if (!canExportAllFindings.value) {
    return;
  }
  const payload = {
    requestId: requestId.value.trim(),
    findings: filteredFindings.value.map((f) => ({
      field: f.field,
      value: f.value,
      kind: f.kind,
      message: f.message,
      mutatedRequestId: f.mutatedRequestId,
      persistedRequestId: f.persistedRequestId,
      verifyRequestId: f.verifyRequestId,
    })),
  };
  const result: Result<{ created: number }> =
    await sdk.backend.createFindings(payload);
  if (result.kind === "Error") {
    errorMessage.value = result.error;
    sdk.window.showToast(result.error, { variant: "error" });
    return;
  }
  sdk.window.showToast(`Exported ${result.value.created} findings`, {
    variant: "success",
  });
};

const deleteSelectedFindings = () => {
  const selectedIds = new Set(selectedFindings.value.map((f) => f.id));
  findings.value = findings.value.filter((f) => !selectedIds.has(f.id));
  selectedFindings.value = [];
  sdk.window.showToast("Deleted selected findings", { variant: "success" });
};

const deleteAllFindings = () => {
  findings.value = [];
  selectedFindings.value = [];
  sdk.window.showToast("Deleted all findings", { variant: "success" });
};
</script>

<template>
  <div class="h-full p-4">
    <Dialog
      v-model:visible="isPreviewOpen"
      modal
      :pt="{
        root: {
          class:
            'w-[92vw] max-w-[96rem] overflow-hidden bg-surface-900 border border-surface-700',
        },
        header: {
          class: 'hidden',
        },
        content: {
          class: 'p-0 bg-surface-900',
        },
      }"
    >
      <div class="flex flex-col">
        <!-- Custom Header -->
        <div
          class="flex items-center justify-between border-b border-surface-700 bg-surface-900 px-4 py-3"
        >
          <span class="text-base font-bold text-surface-0">{{
            previewTitle
          }}</span>
          <Button
            severity="secondary"
            class="flex h-7 w-7 items-center justify-center rounded-full border-none !bg-surface-700 p-0 !text-surface-0 hover:!bg-surface-600"
            @click="isPreviewOpen = false"
          >
            <i class="fas fa-times text-[12px]"></i>
          </Button>
        </div>

        <div class="p-4">
          <div class="flex items-center justify-between gap-3">
            <div class="flex flex-col">
              <span class="text-xs text-surface-400">Request ID</span>
              <span class="text-sm font-medium text-surface-0">{{
                previewRequestId
              }}</span>
            </div>
            <div class="flex items-center gap-2">
              <Button
                label="Copy ID"
                size="small"
                :disabled="previewRequestId.trim().length === 0"
                @click="copyId(previewRequestId)"
              />
              <Button
                label="Copy request"
                size="small"
                :disabled="previewRequestText.trim().length === 0"
                @click="copyText('request', previewRequestText)"
              />
              <Button
                label="Copy response"
                size="small"
                :disabled="(previewResponseText ?? '').trim().length === 0"
                @click="copyText('response', previewResponseText ?? '')"
              />
            </div>
          </div>
          <div class="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div class="flex flex-col gap-2">
              <div class="flex items-center justify-between">
                <span class="text-sm text-surface-300">Request</span>
              </div>
              <Textarea
                :model-value="previewRequestText"
                class="h-[62vh] w-full resize-none border-surface-700 bg-surface-950 font-mono text-sm text-surface-0"
                readonly
              />
            </div>
            <div class="flex flex-col gap-2">
              <div class="flex items-center justify-between">
                <span class="text-sm text-surface-300">Response</span>
              </div>
              <Textarea
                :model-value="previewResponseText ?? ''"
                class="h-[62vh] w-full resize-none border-surface-700 bg-surface-950 font-mono text-sm text-surface-0"
                readonly
              />
            </div>
          </div>
        </div>

        <div
          class="flex justify-end border-t border-surface-700 bg-surface-900 px-4 py-3"
        >
          <Button label="Close" @click="isPreviewOpen = false" />
        </div>
      </div>
    </Dialog>

    <Dialog
      v-model:visible="isDetailsOpen"
      modal
      :pt="{
        root: {
          class:
            'w-[50vw] max-w-[40rem] overflow-hidden bg-surface-900 border border-surface-700',
        },
        header: {
          class: 'hidden',
        },
        content: {
          class: 'p-0 bg-surface-900',
        },
      }"
    >
      <div class="flex flex-col">
        <!-- Custom Header -->
        <div
          class="flex items-center justify-between border-b border-surface-700 bg-surface-900 px-4 py-3"
        >
          <span class="text-base font-bold text-surface-0">{{
            detailsTitle
          }}</span>
          <Button
            severity="secondary"
            class="flex h-7 w-7 items-center justify-center rounded-full border-none !bg-surface-700 p-0 !text-surface-0 hover:!bg-surface-600"
            @click="isDetailsOpen = false"
          >
            <i class="fas fa-times text-[12px]"></i>
          </Button>
        </div>

        <div class="p-4">
          <Textarea
            :model-value="detailsMessage"
            class="h-[20vh] w-full resize-none border-surface-700 bg-surface-950 font-mono text-sm text-surface-0"
            readonly
          />
        </div>

        <div
          class="flex justify-end border-t border-surface-700 bg-surface-900 px-4 py-3"
        >
          <Button label="Close" @click="isDetailsOpen = false" />
        </div>
      </div>
    </Dialog>

    <Card
      class="h-full"
      :pt="{
        body: { class: 'h-full p-0' },
        content: { class: 'h-full flex flex-col gap-0 p-0' },
      }"
    >
      <template #content>
        <Splitter layout="vertical" class="h-full border-none bg-transparent">
          <SplitterPanel
            :size="50"
            :min-size="20"
            class="flex flex-col gap-4 overflow-auto p-4"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <div class="h-10 w-10 overflow-hidden rounded-md">
                  <img
                    v-if="!logoFailed"
                    :src="logoUrl"
                    alt="logo"
                    class="h-full w-full object-contain"
                    @error="logoFailed = true"
                  />
                  <div
                    v-else
                    class="flex h-full w-full items-center justify-center bg-primary-500 text-sm text-white"
                  >
                    MR
                  </div>
                </div>
                <div class="flex flex-col">
                  <span class="text-base font-semibold"
                    >Mass Assignment Radar — Mutation-based Scanner</span
                  >
                  <span class="text-xs text-surface-400">by sp1r1t</span>
                </div>
              </div>
            </div>

            <div class="flex flex-col gap-3">
              <div class="flex flex-wrap items-end justify-between gap-3">
                <div class="flex flex-wrap items-end gap-3">
                  <div class="flex flex-col gap-1">
                    <span class="text-sm text-surface-300"
                      >HTTPQL filter (optional)</span
                    >
                    <InputText v-model="requestsFilter" class="w-[30rem]" />
                  </div>
                  <div class="flex flex-col gap-1">
                    <span class="text-sm text-surface-300">Limit</span>
                    <InputNumber
                      v-model="requestsLimit"
                      class="w-32"
                      :min="1"
                      :max="5000"
                      :use-grouping="false"
                    />
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <Button
                    :label="isLoadingRequests ? 'Loading…' : 'Load JSON'"
                    :disabled="!canLoadRequests"
                    size="small"
                    @click="loadRequests"
                  />
                  <Button
                    label="Clear"
                    :disabled="!canClearRequests"
                    size="small"
                    @click="clearRequests"
                  />
                </div>
              </div>

              <div class="h-48 shrink-0">
                <DataTable
                  v-model:selection="selectedRequest"
                  :value="displayedRequests"
                  data-key="id"
                  selection-mode="single"
                  :row-class="rowClass"
                  class="h-full"
                  striped-rows
                  :pt="{
                    tableContainer: { class: 'h-full overflow-auto' },
                  }"
                >
                  <Column field="createdAt" header="Created" />
                  <Column field="method" header="Method" />
                  <Column field="url" header="URL" />
                  <Column field="hasResponse" header="Has resp" />
                  <Column field="id" header="ID" />
                </DataTable>
              </div>
            </div>

            <div class="flex flex-wrap items-end justify-between gap-4">
              <div class="flex flex-wrap items-end gap-4">
                <div class="flex flex-col gap-1">
                  <span class="text-sm text-surface-300"
                    >Target Request ID</span
                  >
                  <InputText v-model="requestId" class="w-72" />
                </div>
                <div class="flex flex-col gap-1">
                  <span class="text-sm text-surface-300">Max mutations</span>
                  <InputNumber
                    v-model="maxMutations"
                    class="w-24"
                    :min="1"
                    :max="256"
                    :use-grouping="false"
                  />
                </div>
              </div>
              <Button
                :label="isScanning ? 'Stop Scan' : 'Run Scan'"
                :disabled="!canRunScan"
                class="shrink-0"
                size="small"
                @click="runScan"
              />
            </div>

            <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div
                class="flex flex-col gap-3 rounded-md border border-surface-700 p-3"
              >
                <div class="flex items-center gap-2">
                  <Checkbox v-model="includeBuiltInCandidates" binary />
                  <span class="text-sm text-surface-200"
                    >Include built-in candidate fields</span
                  >
                </div>

                <div class="flex items-center gap-2">
                  <Checkbox v-model="mutateExistingFields" binary />
                  <span class="text-sm text-surface-200"
                    >Mutate existing fields</span
                  >
                </div>

                <div class="flex items-center gap-2">
                  <Checkbox v-model="confirmPersistence" binary />
                  <span class="text-sm text-surface-200"
                    >Confirm persistence</span
                  >
                </div>

                <div class="flex items-center gap-2">
                  <span class="text-sm text-surface-300"
                    >Persistence delay (ms)</span
                  >
                  <InputNumber
                    v-model="persistenceDelayMs"
                    class="w-24"
                    :min="0"
                    :max="10000"
                    :disabled="!confirmPersistence"
                    :use-grouping="false"
                  />
                </div>

                <div class="flex items-center gap-2">
                  <Checkbox v-model="verificationEnabled" binary />
                  <span class="text-sm text-surface-200"
                    >Verification request follow-up</span
                  >
                </div>

                <div class="flex items-center gap-2">
                  <span class="text-sm text-surface-300">Method</span>
                  <Select
                    v-model="verificationMethod"
                    :options="verificationMethods"
                    class="w-32"
                    :disabled="!verificationEnabled"
                  />
                  <span class="text-sm text-surface-300">URL</span>
                  <InputText
                    v-model="verificationUrl"
                    class="flex-1"
                    :disabled="!verificationEnabled"
                    placeholder="/me (or full URL)"
                  />
                </div>

                <div
                  v-if="verificationMethod !== 'GET'"
                  class="flex flex-col gap-2"
                >
                  <span class="text-sm text-surface-300">Body (optional)</span>
                  <Textarea
                    v-model="verificationBody"
                    class="w-full"
                    rows="2"
                    :disabled="!verificationEnabled"
                    auto-resize
                    placeholder='{"key": "value"}'
                  />
                </div>

                <div class="flex items-center gap-2">
                  <span class="text-sm text-surface-300">Delay (ms)</span>
                  <InputNumber
                    v-model="verificationDelayMs"
                    class="w-24"
                    :min="0"
                    :max="10000"
                    :disabled="!verificationEnabled"
                    :use-grouping="false"
                  />
                </div>
              </div>

              <div class="flex flex-col gap-4">
                <div class="flex flex-col gap-2">
                  <span class="text-sm text-surface-300"
                    >Candidate fields (comma or newline separated)</span
                  >
                  <Textarea
                    v-model="candidateFieldsText"
                    class="w-full"
                    rows="4"
                    auto-resize
                  />
                </div>

                <div class="flex flex-col gap-2">
                  <span class="text-sm text-surface-300">Value modes</span>
                  <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <div class="flex items-center gap-2">
                      <Checkbox v-model="valueModeBooleanTrue" binary />
                      <span class="text-sm text-surface-200">true</span>
                    </div>
                    <div class="flex items-center gap-2">
                      <Checkbox v-model="valueModeStringAdmin" binary />
                      <span class="text-sm text-surface-200">"admin"</span>
                    </div>
                    <div class="flex items-center gap-2">
                      <Checkbox v-model="valueModeNumberOne" binary />
                      <span class="text-sm text-surface-200">1</span>
                    </div>
                    <div class="flex items-center gap-2">
                      <Checkbox v-model="valueModeNumberPlusOne" binary />
                      <span class="text-sm text-surface-200">+1</span>
                    </div>
                    <div class="flex items-center gap-2">
                      <Checkbox v-model="valueModeNumberMinusOne" binary />
                      <span class="text-sm text-surface-200">-1</span>
                    </div>
                  </div>
                </div>

                <div class="flex flex-col gap-2">
                  <span class="text-sm text-surface-300"
                    >Custom values (comma or newline separated)</span
                  >
                  <Textarea
                    v-model="customValuesText"
                    class="w-full"
                    rows="4"
                    auto-resize
                  />
                </div>
              </div>
            </div>

            <div v-if="errorMessage" class="text-sm text-red-400">
              {{ errorMessage }}
            </div>
          </SplitterPanel>

          <SplitterPanel
            :size="50"
            :min-size="20"
            class="flex flex-col gap-3 overflow-auto p-4"
          >
            <div
              class="sticky top-0 z-10 flex items-center justify-between bg-surface-800 py-2 px-4"
            >
              <div class="flex flex-wrap items-center gap-4">
                <span class="text-sm text-surface-300">Filter kinds</span>
                <div class="flex items-center gap-2">
                  <Checkbox v-model="kindFilter.Reflected" binary />
                  <span class="text-sm text-surface-200">Reflected</span>
                  <Button
                    label="Only"
                    size="small"
                    severity="secondary"
                    class="h-6 px-2 text-[10px] uppercase font-bold"
                    @click="setOnlyKind('Reflected')"
                  />
                </div>
                <div class="flex items-center gap-2">
                  <Checkbox v-model="kindFilter.Persisted" binary />
                  <span class="text-sm text-surface-200">Persisted</span>
                  <Button
                    label="Only"
                    size="small"
                    severity="secondary"
                    class="h-6 px-2 text-[10px] uppercase font-bold"
                    @click="setOnlyKind('Persisted')"
                  />
                </div>
                <div class="flex items-center gap-2">
                  <Checkbox v-model="kindFilter.CodeChanged" binary />
                  <span class="text-sm text-surface-200">CodeChanged</span>
                  <Button
                    label="Only"
                    size="small"
                    severity="secondary"
                    class="h-6 px-2 text-[10px] uppercase font-bold"
                    @click="setOnlyKind('CodeChanged')"
                  />
                </div>
                <div class="flex items-center gap-2">
                  <Checkbox v-model="kindFilter.StateChanged" binary />
                  <span class="text-sm text-surface-200">StateChanged</span>
                  <Button
                    label="Only"
                    size="small"
                    severity="secondary"
                    class="h-6 px-2 text-[10px] uppercase font-bold"
                    @click="setOnlyKind('StateChanged')"
                  />
                </div>
                <div class="flex items-center gap-2">
                  <Checkbox v-model="kindFilter.NonJsonResponse" binary />
                  <span class="text-sm text-surface-200">NonJsonResponse</span>
                  <Button
                    label="Only"
                    size="small"
                    severity="secondary"
                    class="h-6 px-2 text-[10px] uppercase font-bold"
                    @click="setOnlyKind('NonJsonResponse')"
                  />
                </div>
                <div class="flex items-center gap-2">
                  <Checkbox v-model="kindFilter.NoResponse" binary />
                  <span class="text-sm text-surface-200">NoResponse</span>
                  <Button
                    label="Only"
                    size="small"
                    severity="secondary"
                    class="h-6 px-2 text-[10px] uppercase font-bold"
                    @click="setOnlyKind('NoResponse')"
                  />
                </div>
              </div>
              <div class="flex items-center gap-2">
                <Button
                  :label="`Export selected (${selectedFindings.length})`"
                  :disabled="!canExportFindings"
                  size="small"
                  @click="exportSelectedFindings"
                />
                <Button
                  :label="`Export all (${filteredFindings.length})`"
                  :disabled="!canExportAllFindings"
                  size="small"
                  @click="exportAllFindings"
                />
                <Button
                  :label="`Delete selected`"
                  :disabled="selectedFindings.length === 0"
                  size="small"
                  @click="deleteSelectedFindings"
                />
                <Button
                  :label="`Delete all`"
                  :disabled="findings.length === 0"
                  size="small"
                  @click="deleteAllFindings"
                />
              </div>
            </div>

            <DataTable
              v-model:selection="selectedFindings"
              :value="filteredFindings"
              class="h-full flex-1"
              striped-rows
              data-key="id"
              :pt="{
                tableContainer: { class: 'h-full overflow-auto' },
              }"
            >
              <Column selection-mode="multiple" header-style="width:3rem" />
              <Column field="kind" header="Kind" />
              <Column field="field" header="Field" />
              <Column field="value" header="Value" />
              <Column field="baselineCode" header="Baseline" />
              <Column field="mutatedCode" header="Mutated" />
              <Column field="persistedCode" header="Persisted" />
              <Column field="mutatedRequestId" header="Mutated ID" />
              <Column field="persistedRequestId" header="Persisted ID" />
              <Column field="verifyBaselineRequestId" header="Verify base ID" />
              <Column field="verifyRequestId" header="Verify ID" />
              <Column header="Open">
                <template #body="slotProps">
                  <div class="flex items-center gap-2">
                    <Button
                      label="Mutated"
                      size="small"
                      :disabled="!slotProps.data.mutatedRequestId"
                      @click="openMutated(slotProps.data.mutatedRequestId)"
                    />
                    <Button
                      label="Persisted"
                      size="small"
                      :disabled="!slotProps.data.persistedRequestId"
                      @click="openPersisted(slotProps.data.persistedRequestId)"
                    />
                    <Button
                      label="Verify"
                      size="small"
                      :disabled="!slotProps.data.verifyRequestId"
                      @click="openVerify(slotProps.data.verifyRequestId)"
                    />
                  </div>
                </template>
              </Column>
              <Column field="message" header="Details">
                <template #body="slotProps">
                  <Button
                    label="Details"
                    size="small"
                    severity="secondary"
                    @click="openDetails(slotProps.data)"
                  />
                </template>
              </Column>
              <Column field="requestId" header="Request ID" />
            </DataTable>
          </SplitterPanel>
        </Splitter>
      </template>
    </Card>
  </div>
</template>
