import {
  Page,
  Layout,
  Card,
  Text,
  InlineStack,
  Badge,
  Button,
  TextField,
  Select,
  IndexTable,
  useIndexResourceState,
  Modal,
  Spinner,
  EmptyState,
  Scrollable,
  Divider,
  Banner,
  Box,
} from "@shopify/polaris";
import { DeleteIcon, ViewIcon, RefreshIcon } from "@shopify/polaris-icons";
import { BASE_URL } from "app/constant";
import axios from "axios";
import { useCallback, useEffect, useMemo, useState } from "react";

type ErrorLog = {
  _id: string;
  source: string;
  module: string;
  stage: string;
  level: "info" | "warning" | "error" | "critical";
  message: string;
  statusCode?: number | null;
  stack?: string;
  request?: any;
  response?: any;
  context?: {
    orderId?: string;
    email?: string;
    flag?: string;
  };
  externalService?: {
    name?: string;
    endpoint?: string;
    method?: string;
    statusCode?: number | null;
  };
  meta?: any;
  resolved?: boolean;
  resolvedAt?: string | null;
  createdAt?: string;
};

const levelToneMap = {
  info: "info",
  warning: "warning",
  error: "critical",
  critical: "critical",
} as const;

const noisyStages = new Set([
  "validation",
  "address_line1_validation",
  "address_line2_validation",
  "address_compare",
  "duplicate_address_check",
  "service_area_check",
]);

const formatDateTime = (value?: string | null) => {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

const truncate = (value?: string, length = 90) => {
  if (!value) return "-";
  return value.length > length ? `${value.slice(0, length)}...` : value;
};

const safeJson = (value: unknown) => {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "Unable to format data";
  }
};

const StatCard = ({
  title,
  value,
  tone,
  subtext,
}: {
  title: string;
  value: string | number;
  tone?: "base" | "warning" | "critical" | "success";
  subtext?: string;
}) => {
  const toneClass =
    tone === "critical"
      ? "text-red-600"
      : tone === "warning"
        ? "text-amber-600"
        : tone === "success"
          ? "text-green-600"
          : "text-gray-900";

  return (
    <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:shadow-md">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500">
        {title}
      </div>
      <div className={`mt-2 text-3xl font-bold ${toneClass}`}>{value}</div>
      {subtext ? (
        <div className="mt-2 text-sm text-gray-500">{subtext}</div>
      ) : null}
    </div>
  );
};

const InfoPill = ({
  label,
  value,
}: {
  label: string;
  value?: string | number | null;
}) => (
  <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
    <div className="text-[11px] uppercase tracking-[0.12em] text-gray-500">
      {label}
    </div>
    <div className="mt-1 break-all text-sm font-medium text-gray-900">
      {value || "-"}
    </div>
  </div>
);

const JsonBlock = ({ title, value }: { title: string; value: unknown }) => (
  <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
    <div className="border-b border-gray-200 bg-gray-50 px-4 py-3 text-sm font-semibold text-gray-800">
      {title}
    </div>
    <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words px-4 py-4 text-xs text-gray-800">
      {safeJson(value)}
    </pre>
  </div>
);

const FilterChip = ({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) => (
  <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm">
    <span>{label}</span>
    <button
      type="button"
      className="text-gray-400 hover:text-gray-700"
      onClick={onRemove}
    >
      ×
    </button>
  </div>
);

const Logs = () => {
  const [logs, setLogs] = useState<ErrorLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedLog, setSelectedLog] = useState<ErrorLog | null>(null);
  const [deleteLoadingId, setDeleteLoadingId] = useState<string | null>(null);
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);
  const [resolveLoadingId, setResolveLoadingId] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [flagFilter, setFlagFilter] = useState("");
  const [resolvedFilter, setResolvedFilter] = useState("");
  const [hideNoise, setHideNoise] = useState("true");

  const [banner, setBanner] = useState<{
    tone: "success" | "critical" | "warning";
    message: string;
  } | null>(null);

  const fetchLogs = useCallback(async (showLoader = true) => {
    try {
      if (showLoader) setLoading(true);
      const { data } = await axios.get(`${BASE_URL}/error`);
      setLogs(data?.data?.data || []);
    } catch (error) {
      console.error("Failed to fetch logs:", error);
      setLogs([]);
      setBanner({ tone: "critical", message: "Failed to load logs." });
    } finally {
      if (showLoader) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs(true);
  }, [fetchLogs]);

  const refreshLogs = useCallback(async () => {
    try {
      setRefreshing(true);
      const { data } = await axios.get(`${BASE_URL}/error`);
      setLogs(data?.data?.data || []);
      setBanner({ tone: "success", message: "Logs refreshed successfully." });
    } catch (error) {
      console.error("Failed to refresh logs:", error);
      setBanner({ tone: "critical", message: "Refresh failed." });
    } finally {
      setRefreshing(false);
    }
  }, []);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (
        hideNoise === "true" &&
        log.level === "warning" &&
        noisyStages.has(log.stage)
      ) {
        return false;
      }

      const q = query.trim().toLowerCase();

      const matchesQuery =
        !q ||
        log?.message?.toLowerCase().includes(q) ||
        log?.stage?.toLowerCase().includes(q) ||
        log?.source?.toLowerCase().includes(q) ||
        log?.module?.toLowerCase().includes(q) ||
        log?.context?.email?.toLowerCase?.().includes(q) ||
        log?.context?.orderId?.toLowerCase?.().includes(q) ||
        log?._id?.toLowerCase().includes(q);

      const matchesLevel = !levelFilter || log.level === levelFilter;
      const matchesSource = !sourceFilter || log.source === sourceFilter;
      const matchesStage = !stageFilter || log.stage === stageFilter;
      const matchesFlag = !flagFilter || log.context?.flag === flagFilter;

      const matchesResolved =
        !resolvedFilter ||
        (resolvedFilter === "resolved" && log.resolved) ||
        (resolvedFilter === "unresolved" && !log.resolved);

      return (
        matchesQuery &&
        matchesLevel &&
        matchesSource &&
        matchesStage &&
        matchesFlag &&
        matchesResolved
      );
    });
  }, [
    logs,
    query,
    levelFilter,
    sourceFilter,
    stageFilter,
    flagFilter,
    resolvedFilter,
    hideNoise,
  ]);

  const stats = useMemo(() => {
    const total = filteredLogs.length;
    const unresolved = filteredLogs.filter((l) => !l.resolved).length;
    const resolved = filteredLogs.filter((l) => l.resolved).length;
    const errors = filteredLogs.filter((l) => l.level === "error").length;
    const critical = filteredLogs.filter((l) => l.level === "critical").length;
    return { total, unresolved, resolved, errors, critical };
  }, [filteredLogs]);

  const sourceOptions = useMemo(() => {
    const values = Array.from(
      new Set(logs.map((l) => l.source).filter(Boolean)),
    );
    return [
      { label: "All sources", value: "" },
      ...values.map((v) => ({ label: v, value: v })),
    ];
  }, [logs]);

  const stageOptions = useMemo(() => {
    const values = Array.from(
      new Set(logs.map((l) => l.stage).filter(Boolean)),
    );
    return [
      { label: "All stages", value: "" },
      ...values.map((v) => ({ label: v, value: v })),
    ];
  }, [logs]);

  const flagOptions = useMemo(() => {
    const values = Array.from(
      new Set(logs.map((l) => l.context?.flag).filter(Boolean)),
    );
    return [
      { label: "All flags", value: "" },
      ...values.map((v) => ({ label: String(v), value: String(v) })),
    ];
  }, [logs]);

  const levelOptions = [
    { label: "All levels", value: "" },
    { label: "Critical", value: "critical" },
    { label: "Error", value: "error" },
    { label: "Warning", value: "warning" },
    { label: "Info", value: "info" },
  ];

  const resolvedOptions = [
    { label: "All status", value: "" },
    { label: "Unresolved", value: "unresolved" },
    { label: "Resolved", value: "resolved" },
  ];

  const hideNoiseOptions = [
    { label: "Hide rule/validation warnings", value: "true" },
    { label: "Show all warnings", value: "false" },
  ];

  const resourceName = {
    singular: "log",
    plural: "logs",
  };

  const {
    selectedResources,
    allResourcesSelected,
    handleSelectionChange,
    clearSelection,
  } = useIndexResourceState(filteredLogs);

  const activeFilterCount = [
    query,
    levelFilter,
    sourceFilter,
    stageFilter,
    flagFilter,
    resolvedFilter,
  ].filter(Boolean).length;

  const clearAllFilters = () => {
    setQuery("");
    setLevelFilter("");
    setSourceFilter("");
    setStageFilter("");
    setFlagFilter("");
    setResolvedFilter("");
    setHideNoise("true");
  };

  const handleDelete = async (id: string) => {
    try {
      setDeleteLoadingId(id);
      await axios.delete(`${BASE_URL}/error/${id}`);
      setLogs((prev) => prev.filter((log) => log._id !== id));
      if (selectedLog?._id === id) setSelectedLog(null);
      setBanner({ tone: "success", message: "Log deleted successfully." });
    } catch (error) {
      console.error("Failed to delete log:", error);
      setBanner({ tone: "critical", message: "Failed to delete log." });
    } finally {
      setDeleteLoadingId(null);
    }
  };

  const handleBulkDelete = async () => {
    if (!selectedResources.length) return;

    try {
      setBulkDeleteLoading(true);
      await axios.delete(`${BASE_URL}/error`, {
        data: { ids: selectedResources },
      });

      const selectedSet = new Set(selectedResources);
      setLogs((prev) => prev.filter((log) => !selectedSet.has(log._id)));

      if (selectedLog && selectedSet.has(selectedLog._id)) {
        setSelectedLog(null);
      }

      clearSelection();
      setBanner({
        tone: "success",
        message: "Selected logs deleted successfully.",
      });
    } catch (error) {
      console.error("Failed to bulk delete logs:", error);
      setBanner({ tone: "critical", message: "Bulk delete failed." });
    } finally {
      setBulkDeleteLoading(false);
    }
  };

  const handleResolveToggle = async (log: ErrorLog) => {
    try {
      setResolveLoadingId(log._id);

      const { data } = await axios.patch(
        `${BASE_URL}/error/${log._id}/resolution`,
        {
          resolved: !log.resolved,
        },
      );

      const updated = data?.data;

      setLogs((prev) =>
        prev.map((item) =>
          item._id === log._id ? { ...item, ...updated } : item,
        ),
      );

      if (selectedLog?._id === log._id) {
        setSelectedLog((prev) => (prev ? { ...prev, ...updated } : prev));
      }

      setBanner({
        tone: "success",
        message: updated?.resolved
          ? "Log marked as resolved."
          : "Log marked as unresolved.",
      });
    } catch (error) {
      console.error("Failed to update resolution:", error);
      setBanner({ tone: "critical", message: "Failed to update log status." });
    } finally {
      setResolveLoadingId(null);
    }
  };

  const rowMarkup = filteredLogs.map((log, index) => (
    <IndexTable.Row
      id={log._id}
      key={log._id}
      selected={selectedResources.includes(log._id)}
      position={index}
    >
      <IndexTable.Cell>
        <div className="min-w-[320px]">
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            {truncate(log.message, 95)}
          </Text>
          <div className="mt-1 text-xs text-gray-500">{log._id}</div>
        </div>
      </IndexTable.Cell>

      <IndexTable.Cell>
        <Badge tone={levelToneMap[log.level] || "info"}>{log.level}</Badge>
      </IndexTable.Cell>

      <IndexTable.Cell>{log.source || "-"}</IndexTable.Cell>
      <IndexTable.Cell>{log.stage || "-"}</IndexTable.Cell>
      <IndexTable.Cell>{log.context?.flag || "-"}</IndexTable.Cell>
      <IndexTable.Cell>{log.statusCode ?? "-"}</IndexTable.Cell>
      <IndexTable.Cell>{log.context?.email || "-"}</IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={log.resolved ? "success" : "attention"}>
          {log.resolved ? "Resolved" : "Open"}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>{formatDateTime(log.createdAt)}</IndexTable.Cell>

      <IndexTable.Cell>
        <InlineStack gap="200" wrap={false}>
          <Button
            size="micro"
            icon={ViewIcon}
            onClick={() => setSelectedLog(log)}
          >
            View
          </Button>
        </InlineStack>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      title="Error Monitor"
      subtitle="Professional monitoring view for actionable incidents."
      primaryAction={{
        content: "Refresh",
        icon: RefreshIcon,
        onAction: refreshLogs,
        loading: refreshing,
      }}
    >
      <div className="space-y-6">
        {banner ? (
          <Banner tone={banner.tone} onDismiss={() => setBanner(null)}>
            {banner.message}
          </Banner>
        ) : null}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <StatCard title="Visible Logs" value={stats.total} />
          <StatCard title="Open" value={stats.unresolved} tone="warning" />
          <StatCard title="Resolved" value={stats.resolved} tone="success" />
          <StatCard title="Errors" value={stats.errors} tone="critical" />
          <StatCard title="Critical" value={stats.critical} tone="critical" />
        </div>

        <Layout>
          <Layout.Section>
            <Card>
              <div className="space-y-5 p-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                  <div>
                    <div className="text-lg font-semibold text-gray-900">
                      Monitoring Console
                    </div>
                    <div className="mt-1 text-sm text-gray-500">
                      Search, triage, resolve, and clean incidents efficiently.
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      onClick={refreshLogs}
                      loading={refreshing}
                      icon={RefreshIcon}
                    >
                      Refresh
                    </Button>
                    <Button
                      destructive
                      icon={DeleteIcon}
                      disabled={!selectedResources.length}
                      loading={bulkDeleteLoading}
                      onClick={handleBulkDelete}
                    >
                      Delete Selected
                    </Button>
                  </div>
                </div>

                <Divider />

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                  <div className="lg:col-span-4">
                    <TextField
                      label="Search"
                      labelHidden
                      autoComplete="off"
                      placeholder="Search message, email, stage, order id, id"
                      value={query}
                      onChange={setQuery}
                    />
                  </div>

                  <div className="lg:col-span-2">
                    <Select
                      label="Level"
                      labelHidden
                      options={levelOptions}
                      value={levelFilter}
                      onChange={setLevelFilter}
                    />
                  </div>

                  <div className="lg:col-span-2">
                    <Select
                      label="Source"
                      labelHidden
                      options={sourceOptions}
                      value={sourceFilter}
                      onChange={setSourceFilter}
                    />
                  </div>

                  <div className="lg:col-span-2">
                    <Select
                      label="Stage"
                      labelHidden
                      options={stageOptions}
                      value={stageFilter}
                      onChange={setStageFilter}
                    />
                  </div>

                  <div className="lg:col-span-2">
                    <Select
                      label="Flag"
                      labelHidden
                      options={flagOptions}
                      value={flagFilter}
                      onChange={setFlagFilter}
                    />
                  </div>

                  <div className="lg:col-span-3">
                    <Select
                      label="Resolved"
                      labelHidden
                      options={resolvedOptions}
                      value={resolvedFilter}
                      onChange={setResolvedFilter}
                    />
                  </div>

                  <div className="lg:col-span-3">
                    <Select
                      label="Noise"
                      labelHidden
                      options={hideNoiseOptions}
                      value={hideNoise}
                      onChange={setHideNoise}
                    />
                  </div>

                  <div className="lg:col-span-6 flex items-center justify-end">
                    <InlineStack gap="200" wrap>
                      <Badge tone="info">Results: {filteredLogs.length}</Badge>
                      {selectedResources.length ? (
                        <Badge tone="attention">
                          Selected: {selectedResources.length}
                        </Badge>
                      ) : null}
                      {activeFilterCount ? (
                        <Button size="micro" onClick={clearAllFilters}>
                          Clear filters
                        </Button>
                      ) : null}
                    </InlineStack>
                  </div>
                </div>

                {activeFilterCount ? (
                  <div className="flex flex-wrap gap-2">
                    {query ? (
                      <FilterChip
                        label={`Search: ${query}`}
                        onRemove={() => setQuery("")}
                      />
                    ) : null}
                    {levelFilter ? (
                      <FilterChip
                        label={`Level: ${levelFilter}`}
                        onRemove={() => setLevelFilter("")}
                      />
                    ) : null}
                    {sourceFilter ? (
                      <FilterChip
                        label={`Source: ${sourceFilter}`}
                        onRemove={() => setSourceFilter("")}
                      />
                    ) : null}
                    {stageFilter ? (
                      <FilterChip
                        label={`Stage: ${stageFilter}`}
                        onRemove={() => setStageFilter("")}
                      />
                    ) : null}
                    {flagFilter ? (
                      <FilterChip
                        label={`Flag: ${flagFilter}`}
                        onRemove={() => setFlagFilter("")}
                      />
                    ) : null}
                    {resolvedFilter ? (
                      <FilterChip
                        label={`State: ${resolvedFilter}`}
                        onRemove={() => setResolvedFilter("")}
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card padding="0">
              {loading ? (
                <div className="flex min-h-[360px] items-center justify-center">
                  <Spinner accessibilityLabel="Loading logs" size="large" />
                </div>
              ) : filteredLogs.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    heading="No important logs found"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>No logs match the current filters.</p>
                  </EmptyState>
                </div>
              ) : (
                <IndexTable
                  resourceName={resourceName}
                  itemCount={filteredLogs.length}
                  selectedItemsCount={
                    allResourcesSelected ? "All" : selectedResources.length
                  }
                  onSelectionChange={handleSelectionChange}
                  headings={[
                    { title: "Message" },
                    { title: "Level" },
                    { title: "Source" },
                    { title: "Stage" },
                    { title: "Flag" },
                    { title: "Status" },
                    { title: "Email" },
                    { title: "State" },
                    { title: "Created At" },
                    { title: "Action" },
                  ]}
                  promotedBulkActions={[
                    {
                      content: `Delete selected (${selectedResources.length})`,
                      onAction: handleBulkDelete,
                      disabled: !selectedResources.length || bulkDeleteLoading,
                    },
                  ]}
                >
                  {rowMarkup}
                </IndexTable>
              )}
            </Card>
          </Layout.Section>
        </Layout>
      </div>

      <Modal
        open={!!selectedLog}
        onClose={() => setSelectedLog(null)}
        title="Incident details"
        large
        primaryAction={
          selectedLog
            ? {
                content: selectedLog.resolved
                  ? "Mark unresolved"
                  : "Mark resolved",
                onAction: () => handleResolveToggle(selectedLog),
                loading: resolveLoadingId === selectedLog._id,
              }
            : undefined
        }
        secondaryActions={
          selectedLog
            ? [
                {
                  content: "Delete",
                  destructive: true,
                  onAction: () => handleDelete(selectedLog._id),
                  loading: deleteLoadingId === selectedLog._id,
                },
              ]
            : undefined
        }
      >
        <Modal.Section>
          {selectedLog && (
            <Scrollable shadow style={{ maxHeight: "75vh" }}>
              <div className="space-y-5 p-1">
                <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
                  <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold text-gray-900">
                        {selectedLog.message}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        {selectedLog._id}
                      </div>
                    </div>

                    <InlineStack gap="200" wrap>
                      <Badge tone={levelToneMap[selectedLog.level] || "info"}>
                        {selectedLog.level}
                      </Badge>
                      <Badge
                        tone={selectedLog.resolved ? "success" : "attention"}
                      >
                        {selectedLog.resolved ? "Resolved" : "Open"}
                      </Badge>
                    </InlineStack>
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <InfoPill label="Source" value={selectedLog.source} />
                    <InfoPill label="Stage" value={selectedLog.stage} />
                    <InfoPill label="Flag" value={selectedLog.context?.flag} />
                    <InfoPill
                      label="Status Code"
                      value={selectedLog.statusCode}
                    />
                    <InfoPill
                      label="Email"
                      value={selectedLog.context?.email}
                    />
                    <InfoPill
                      label="Order ID"
                      value={selectedLog.context?.orderId}
                    />
                    <InfoPill
                      label="Created At"
                      value={formatDateTime(selectedLog.createdAt)}
                    />
                    <InfoPill
                      label="Resolved At"
                      value={formatDateTime(selectedLog.resolvedAt)}
                    />
                    <InfoPill
                      label="Service"
                      value={selectedLog.externalService?.name}
                    />
                  </div>
                </div>

                {selectedLog.stack ? (
                  <JsonBlock title="Stack Trace" value={selectedLog.stack} />
                ) : null}

                <JsonBlock title="Request" value={selectedLog.request} />

                {selectedLog.response?.data ? (
                  <JsonBlock title="Response" value={selectedLog.response} />
                ) : null}

                {selectedLog.meta ? (
                  <JsonBlock title="Meta" value={selectedLog.meta} />
                ) : null}
              </div>
            </Scrollable>
          )}
        </Modal.Section>
      </Modal>
    </Page>
  );
};

export default Logs;
