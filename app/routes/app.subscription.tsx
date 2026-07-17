import { useState, useEffect, useCallback, useMemo } from "react";
import apiClient from "app/config/AxiosInstance";
import {
  Page,
  LegacyCard,
  IndexTable,
  useIndexResourceState,
  Badge,
  Button,
  Text,
  BlockStack,
  InlineStack,
  Modal,
  Pagination,
  Select,
  Divider,
  Box,
  Grid,
  Avatar,
  Icon,
  TextField,
  Banner,
} from "@shopify/polaris";
import {
  ViewIcon,
  EmailIcon,
  MegaphoneIcon,
  CalendarIcon,
  ProductIcon,
  ProfileIcon,
  SearchIcon,
} from "@shopify/polaris-icons";

type Demographics = {
  age?: string;
  gender?: string;
  identity?: string;
  household_size?: string;
  ethnicity?: string;
  household_language?: string;
  identifyAsLGBTQ?: string;
  wehoHearAboutUs?: string;
};

type Item = {
  _id: string;
  isActive: boolean;
  firstName: string;
  lastName: string;
  email: string;
  subscription: string;
  streetAddress: string;
  streetAddress2?: string;
  postCode?: string;
  source?: string;
  normalizedAddress?: string;
  normalizedAddress2?: string;
  lastRenewAt: string;
  createdAt?: string;
  updatedAt?: string;
  productId?: string;
  flag?: string;
  demographics?: Demographics;
  mailingCity?: string;
};

type Verdict = {
  eligible: boolean;
  program?: string;
  municipality?: string;
  mailingCity?: string;
  message?: string;
  transient?: boolean;
  typedZip?: string;
  matchedZip?: string;
};

type OrdersResponse = {
  statusCode: number;
  success: boolean;
  message: string;
  data: {
    data: Item[];
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    nextPage: boolean;
    prevPage: boolean;
    filteredBy?: string;
  };
};

const fmt = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "long",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/* ++ QUARTERLY ++  Next shipment mirrors the backend rule: +3 calendar
   months, rounded UP to the 1st of the following month unless it already
   lands on a 1st. Display-only; backend cycle.js is the source of truth. */
const RECURRING = ["monthly", "quarterly", "recurring"];
const isRecurring = (s?: string) => RECURRING.includes(String(s || ""));
const subLabel = (s?: string) =>
  isRecurring(s) ? "Quarterly" : s === "one_time" ? "One-time" : s || "—";

function nextShipment(last?: string | null): Date | null {
  if (!last) return null;
  const d = new Date(last);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getUTCDate();
  const base = new Date(d);
  base.setUTCDate(1);
  base.setUTCMonth(base.getUTCMonth() + 3);
  const lastDay = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0),
  ).getUTCDate();
  base.setUTCDate(Math.min(day, lastDay));
  if (base.getUTCDate() === 1) return base;
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 1));
}

const Subscription = () => {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [limit] = useState(15);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [hasPrevPage, setHasPrevPage] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<string>("");
  const [filteredBy, setFilteredBy] = useState<string>("");
  const [modalOpen, setModalOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [target, setTarget] = useState<Item | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  /* ++ SEARCH ++ name or email; applied server-side. */
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  /* ++ ADDRESS VALIDATION (detail modal) ++ */
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [validating, setValidating] = useState(false);

  const load = useCallback(
    async (p = page, source = sourceFilter, q = search) => {
      setLoading(true);
      try {
        const params: any = { page: p, limit };
        if (source) params.source = source;
        if (q) params.search = q;
        const { data } = await apiClient.get<OrdersResponse>("/order", {
          params,
        });
        setItems(data?.data?.data ?? []);
        setTotalPages(data?.data?.totalPages ?? 1);
        setTotal(data?.data?.total ?? 0);
        setHasNextPage(data?.data?.nextPage ?? false);
        setHasPrevPage(data?.data?.prevPage ?? false);
        setFilteredBy(data?.data?.filteredBy || "");
      } catch (error) {
        console.error("Error loading orders:", error);
      } finally {
        setLoading(false);
      }
    },
    [page, limit, sourceFilter, search],
  );

  useEffect(() => {
    load(1, sourceFilter, search);
    setPage(1);
  }, [sourceFilter, search]);

  const runSearch = useCallback(
    () => setSearch(searchInput.trim()),
    [searchInput],
  );
  const clearSearch = useCallback(() => {
    setSearchInput("");
    setSearch("");
  }, []);

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(items, { resourceIDResolver: (i) => i._id });

  const askCancel = useCallback((item: Item) => {
    setTarget(item);
    setModalOpen(true);
  }, []);

  const showDetails = useCallback((item: Item) => {
    setTarget(item);
    setVerdict(null);
    setDetailModalOpen(true);
  }, []);

  const confirmCancel = useCallback(async () => {
    if (!target) return;
    setActionBusy(target._id);
    try {
      await apiClient.put(`/order/${target._id}`, { isActive: false });
      await load(page, sourceFilter, search);
      selectedResources.length = 0;
    } finally {
      setActionBusy(null);
      setTarget(null);
      setModalOpen(false);
    }
  }, [target, load, page, sourceFilter, search, selectedResources.length]);

  const validateTargetAddress = useCallback(async () => {
    if (!target) return;
    setValidating(true);
    setVerdict(null);
    try {
      const flag =
        target.flag ||
        (String(target.source || "")
          .toLowerCase()
          .includes("la")
          ? "defentLA"
          : "defentWeho");
      const { data } = await apiClient.post("/order/validate-address", {
        streetAddress: target.streetAddress,
        streetAddress2: target.streetAddress2 || "",
        postCode: target.postCode || "",
        flag,
      });
      setVerdict(data?.data ?? { eligible: false, message: data?.message });
    } catch (e: any) {
      setVerdict({
        eligible: false,
        transient: true,
        message:
          e?.response?.status === 429
            ? "Too many checks — wait a few minutes and try again."
            : "Validation service unreachable.",
      });
    } finally {
      setValidating(false);
    }
  }, [target]);

  const handlePageChange = useCallback(
    (newPage: number) => {
      setPage(newPage);
      load(newPage, sourceFilter, search);
    },
    [load, sourceFilter, search],
  );

  const headings = useMemo(
    () => [
      { title: "Customer" },
      { title: "Subscription" },
      { title: "Active" },
      { title: "Street address" },
      { title: "Source" },
      { title: "Last order" },
      { title: "Next shipment" },
      { title: "Actions" },
    ],
    [],
  );

  const sourceOptions = [
    { label: "All Sources", value: "" },
    { label: "Defent Weho", value: "defentWeho" },
    { label: "Defent La", value: "defentLa" },
  ];

  return (
    <Page
      title="Subscription Management"
      subtitle={
        search
          ? `Search results for "${search}" (all time)`
          : "Customers with orders in the past 30 days"
      }
    >
      <LegacyCard>
        <div style={{ padding: "16px", borderBottom: "1px solid #e1e1e1" }}>
          <InlineStack gap="400" align="space-between" blockAlign="end" wrap>
            <InlineStack gap="300" blockAlign="end">
              <div style={{ minWidth: "260px" }}>
                <TextField
                  label="Search"
                  labelHidden
                  value={searchInput}
                  onChange={setSearchInput}
                  autoComplete="off"
                  placeholder="Search name or email…"
                  prefix={<Icon source={SearchIcon} tone="base" />}
                  clearButton
                  onClearButtonClick={clearSearch}
                />
              </div>
              <Button
                onClick={runSearch}
                disabled={!searchInput.trim() && !search}
              >
                Search
              </Button>
              <div style={{ minWidth: "200px" }}>
                <Select
                  label="Filter by source"
                  labelHidden
                  options={sourceOptions}
                  value={sourceFilter}
                  onChange={(value) => setSourceFilter(value)}
                  placeholder="Select source"
                />
              </div>
            </InlineStack>
            {(filteredBy || search) && (
              <Badge tone="info">
                {`${filteredBy ? `Filtered: ${filteredBy}` : "All sources"}${search ? ` · "${search}"` : ""} (${total} orders)`}
              </Badge>
            )}
          </InlineStack>
        </div>

        <IndexTable
          resourceName={{ singular: "subscription", plural: "subscriptions" }}
          itemCount={items.length}
          selectedItemsCount={
            allResourcesSelected ? "All" : selectedResources.length
          }
          onSelectionChange={handleSelectionChange}
          headings={headings as any}
          selectable
          loading={loading}
          emptyState={
            <BlockStack inlineAlign="center" gap="200">
              <Text as="p" tone="subdued">
                {search
                  ? `No customers match "${search}".`
                  : "No subscriptions found."}
              </Text>
            </BlockStack>
          }
        >
          {items?.map((item, index) => {
            const lastOrder = item.lastRenewAt
              ? new Date(item.lastRenewAt)
              : null;
            const recurringActive =
              isRecurring(item.subscription) && item.isActive;
            const nextOrder = recurringActive
              ? nextShipment(item.lastRenewAt)
              : null;
            const name =
              `${item.firstName ?? ""} ${item.lastName ?? ""}`.trim() || "—";
            return (
              <IndexTable.Row
                id={item._id}
                key={item._id}
                position={index}
                selected={selectedResources.includes(item._id)}
              >
                <IndexTable.Cell>
                  <BlockStack gap="050">
                    <Text as="span" variant="bodyMd" fontWeight="semibold">
                      {name}
                    </Text>
                    <Text as="span" tone="subdued" variant="bodySm">
                      {item.email || "—"}
                    </Text>
                  </BlockStack>
                </IndexTable.Cell>

                <IndexTable.Cell>
                  <Badge
                    tone={
                      isRecurring(item.subscription) ? "success" : "attention"
                    }
                  >
                    {subLabel(item.subscription)}
                  </Badge>
                </IndexTable.Cell>

                <IndexTable.Cell>
                  <Badge tone={item.isActive ? "success" : "critical"}>
                    {item.isActive ? "Active" : "Inactive"}
                  </Badge>
                </IndexTable.Cell>

                <IndexTable.Cell>
                  <BlockStack gap="050">
                    <Text as="span" variant="bodyMd">
                      {item.streetAddress || "—"}
                    </Text>
                    {item.streetAddress2 && (
                      <Text as="span" tone="subdued" variant="bodySm">
                        {item.streetAddress2}
                      </Text>
                    )}
                    {item.postCode && (
                      <Text as="span" tone="subdued" variant="bodySm">
                        {item.postCode}
                      </Text>
                    )}
                  </BlockStack>
                </IndexTable.Cell>

                <IndexTable.Cell>
                  <Badge
                    tone={item.source?.includes("Defent") ? "info" : "success"}
                  >
                    {item.source || "weho"}
                  </Badge>
                </IndexTable.Cell>

                <IndexTable.Cell>
                  <Text as="span" variant="bodyMd">
                    {lastOrder ? fmt.format(lastOrder) : "—"}
                  </Text>
                </IndexTable.Cell>

                <IndexTable.Cell>
                  <Text as="span" variant="bodyMd">
                    {nextOrder ? fmt.format(nextOrder) : "—"}
                  </Text>
                </IndexTable.Cell>

                <IndexTable.Cell>
                  <InlineStack gap="200">
                    <Button
                      variant="tertiary"
                      icon={ViewIcon}
                      onClick={() => showDetails(item)}
                    >
                      Details
                    </Button>
                    <Button
                      variant="tertiary"
                      tone="critical"
                      disabled={!item.isActive || actionBusy === item._id}
                      loading={actionBusy === item._id}
                      onClick={() => askCancel(item)}
                    >
                      Cancel
                    </Button>
                  </InlineStack>
                </IndexTable.Cell>
              </IndexTable.Row>
            );
          })}
        </IndexTable>

        <div style={{ padding: "16px" }}>
          <BlockStack gap="400" align="center">
            <Pagination
              hasPrevious={hasPrevPage}
              onPrevious={() => handlePageChange(page - 1)}
              hasNext={hasNextPage}
              onNext={() => handlePageChange(page + 1)}
            />
            <Text tone="subdued" as="span">
              Page {page} of {totalPages} • Total {total} orders
            </Text>
          </BlockStack>
        </div>
      </LegacyCard>

      {/* Cancel Subscription Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Cancel subscription?"
        primaryAction={{
          content: "Cancel subscription",
          destructive: true,
          onAction: confirmCancel,
        }}
        secondaryActions={[
          { content: "Close", onAction: () => setModalOpen(false) },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p">
              This stops future quarterly shipments for{" "}
              <Text as="span" fontWeight="semibold">
                {target ? `${target.firstName} ${target.lastName}` : ""}
              </Text>
              . Any order already created still ships.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Detail Modal — redesigned: left-aligned headers, uniform tiles */}
      <Modal
        open={detailModalOpen}
        onClose={() => setDetailModalOpen(false)}
        title="Customer Details"
        size="large"
        primaryAction={{
          content: "Close",
          onAction: () => setDetailModalOpen(false),
        }}
      >
        {target && (
          <Box padding="400">
            <BlockStack gap="500">
              {/* Header */}
              <Box
                padding="400"
                background="bg-surface-secondary"
                borderRadius="300"
              >
                <InlineStack gap="400" blockAlign="center" wrap={false}>
                  <Avatar
                    size="lg"
                    name={`${target.firstName} ${target.lastName}`}
                    source={undefined}
                  />
                  <BlockStack gap="150">
                    <Text as="h2" variant="headingLg" fontWeight="bold">
                      {target.firstName} {target.lastName}
                    </Text>
                    <Text as="p" tone="subdued">
                      {target.email}
                    </Text>
                    <InlineStack gap="200">
                      <Badge tone={target.isActive ? "success" : "critical"}>
                        {target.isActive ? "Active" : "Inactive"}
                      </Badge>
                      <Badge
                        tone={
                          isRecurring(target.subscription)
                            ? "success"
                            : "attention"
                        }
                      >
                        {subLabel(target.subscription)}
                      </Badge>
                      <Badge
                        tone={
                          target.source?.includes("Defent") ? "info" : "success"
                        }
                      >
                        {target.source || "weho"}
                      </Badge>
                    </InlineStack>
                  </BlockStack>
                </InlineStack>
              </Box>

              {/* Address */}
              <BlockStack gap="300">
                <InlineStack gap="150" blockAlign="center">
                  <Icon source={MegaphoneIcon} tone="base" />
                  <Text as="h3" variant="headingMd" fontWeight="semibold">
                    Address
                  </Text>
                </InlineStack>
                <Divider />
                <Grid columns={{ xs: 1, sm: 2 }}>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 3 }}>
                    <Box
                      padding="300"
                      background="bg-surface-secondary"
                      borderRadius="200"
                      minHeight="100%"
                    >
                      <BlockStack gap="100">
                        <Text as="p" tone="subdued" variant="bodySm">
                          Street address
                        </Text>
                        <Text as="p" variant="bodyMd" fontWeight="medium">
                          {[target.streetAddress, target.streetAddress2]
                            .filter(Boolean)
                            .join(", ")}
                        </Text>
                        <Text as="p" variant="bodyMd">
                          {[target.mailingCity, target.postCode]
                            .filter(Boolean)
                            .join(", ") || "—"}
                        </Text>
                      </BlockStack>
                    </Box>
                  </Grid.Cell>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 3 }}>
                    <Box
                      padding="300"
                      background="bg-surface-secondary"
                      borderRadius="200"
                      minHeight="100%"
                    >
                      <BlockStack gap="100">
                        <Text as="p" tone="subdued" variant="bodySm">
                          Verified as (Census)
                        </Text>
                        <Text as="p" variant="bodyMd">
                          {target.normalizedAddress || "—"}
                          {target.normalizedAddress2
                            ? ` · unit ${target.normalizedAddress2}`
                            : ""}
                        </Text>
                      </BlockStack>
                    </Box>
                  </Grid.Cell>
                </Grid>

                <InlineStack gap="200">
                  <Button loading={validating} onClick={validateTargetAddress}>
                    Validate this address now
                  </Button>
                </InlineStack>
                {verdict && (
                  <Banner
                    tone={
                      verdict.eligible
                        ? "success"
                        : verdict.transient
                          ? "warning"
                          : "critical"
                    }
                    title={
                      verdict.eligible
                        ? `Valid for ${verdict.program}`
                        : verdict.transient
                          ? "Could not verify right now"
                          : "Address check failed"
                    }
                  >
                    <BlockStack gap="100">
                      <p>{verdict.message}</p>
                      {verdict.municipality && (
                        <Text as="p" variant="bodySm" tone="subdued">
                          Municipality: {verdict.municipality}
                          {verdict.mailingCity
                            ? ` · label city: ${verdict.mailingCity}`
                            : ""}
                          {verdict.matchedZip
                            ? ` · ZIP typed ${verdict.typedZip} / Census ${verdict.matchedZip}`
                            : ""}
                        </Text>
                      )}
                    </BlockStack>
                  </Banner>
                )}
              </BlockStack>

              {/* Schedule */}
              <BlockStack gap="300">
                <InlineStack gap="150" blockAlign="center">
                  <Icon source={CalendarIcon} tone="base" />
                  <Text as="h3" variant="headingMd" fontWeight="semibold">
                    Order Timeline
                  </Text>
                </InlineStack>
                <Divider />
                <Grid columns={{ xs: 1, sm: 3 }}>
                  {(
                    [
                      [
                        "Created",
                        target.createdAt
                          ? fmt.format(new Date(target.createdAt))
                          : "—",
                      ],
                      [
                        "Last order",
                        target.lastRenewAt
                          ? fmt.format(new Date(target.lastRenewAt))
                          : "—",
                      ],
                      [
                        "Next shipment",
                        isRecurring(target.subscription) && target.isActive
                          ? (() => {
                              const n = nextShipment(target.lastRenewAt);
                              return n
                                ? `${fmt.format(n)} (1st of month)`
                                : "—";
                            })()
                          : "— (not recurring)",
                      ],
                    ] as [string, string][]
                  ).map(([label, value]) => (
                    <Grid.Cell key={label} columnSpan={{ xs: 6, sm: 2 }}>
                      <Box
                        padding="300"
                        background="bg-surface-secondary"
                        borderRadius="200"
                        minHeight="100%"
                      >
                        <BlockStack gap="100">
                          <Text as="p" tone="subdued" variant="bodySm">
                            {label}
                          </Text>
                          <Text as="p" variant="bodyMd" fontWeight="medium">
                            {value}
                          </Text>
                        </BlockStack>
                      </Box>
                    </Grid.Cell>
                  ))}
                </Grid>
              </BlockStack>

              {/* Demographics */}
              {target.demographics &&
                Object.keys(target.demographics).some(
                  (key) => target.demographics?.[key as keyof Demographics],
                ) && (
                  <BlockStack gap="300">
                    <InlineStack gap="150" blockAlign="center">
                      <Icon source={ProfileIcon} tone="base" />
                      <Text as="h3" variant="headingMd" fontWeight="semibold">
                        Demographics
                      </Text>
                    </InlineStack>
                    <Divider />
                    <Grid columns={{ xs: 2, sm: 4 }}>
                      {(
                        [
                          ["Age", target.demographics.age],
                          ["Gender", target.demographics.gender],
                          ["Identity", target.demographics.identity],
                          [
                            "Household size",
                            target.demographics.household_size,
                          ],
                          ["Ethnicity", target.demographics.ethnicity],
                          ["Language", target.demographics.household_language],
                          ["LGBTQ+", target.demographics.identifyAsLGBTQ],
                          [
                            "Heard about us",
                            target.demographics.wehoHearAboutUs,
                          ],
                        ] as [string, string | undefined][]
                      )
                        .filter(([, v]) => v)
                        .map(([label, value]) => (
                          <Grid.Cell key={label} columnSpan={{ xs: 3, sm: 2 }}>
                            <Box
                              padding="300"
                              background="bg-surface-secondary"
                              borderRadius="200"
                              minHeight="100%"
                            >
                              <BlockStack gap="100">
                                <Text as="p" tone="subdued" variant="bodySm">
                                  {label}
                                </Text>
                                <Text
                                  as="p"
                                  variant="bodyMd"
                                  fontWeight="medium"
                                >
                                  {value}
                                </Text>
                              </BlockStack>
                            </Box>
                          </Grid.Cell>
                        ))}
                    </Grid>
                  </BlockStack>
                )}

              {/* Reference */}
              <BlockStack gap="300">
                <InlineStack gap="150" blockAlign="center">
                  <Icon source={ProductIcon} tone="base" />
                  <Text as="h3" variant="headingMd" fontWeight="semibold">
                    Reference
                  </Text>
                </InlineStack>
                <Divider />
                <Grid columns={{ xs: 1, sm: 2 }}>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 3 }}>
                    <Box
                      padding="300"
                      background="bg-surface-secondary"
                      borderRadius="200"
                      minHeight="100%"
                    >
                      <BlockStack gap="100">
                        <Text as="p" tone="subdued" variant="bodySm">
                          Customer ID
                        </Text>
                        <Text as="p" variant="bodyMd" fontWeight="medium">
                          {target._id}
                        </Text>
                      </BlockStack>
                    </Box>
                  </Grid.Cell>
                  {target.productId && (
                    <Grid.Cell columnSpan={{ xs: 6, sm: 3 }}>
                      <Box
                        padding="300"
                        background="bg-surface-secondary"
                        borderRadius="200"
                        minHeight="100%"
                      >
                        <BlockStack gap="100">
                          <Text as="p" tone="subdued" variant="bodySm">
                            Product ID
                          </Text>
                          <Text as="p" variant="bodyMd" fontWeight="medium">
                            {target.productId}
                          </Text>
                        </BlockStack>
                      </Box>
                    </Grid.Cell>
                  )}
                </Grid>
              </BlockStack>
            </BlockStack>
          </Box>
        )}
      </Modal>
    </Page>
  );
};

export default Subscription;
