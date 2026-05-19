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
  Card,
  Avatar,
  Icon,
} from "@shopify/polaris";
import {
  ViewIcon,
  EmailIcon,
  MegaphoneIcon,
  CalendarIcon,
  ProductIcon,
  TaxIcon,
  ProfileIcon,
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

const addDays = (d: Date, n: number) =>
  new Date(d.getTime() + n * 24 * 60 * 60 * 1000);

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

  const load = useCallback(
    async (p = page, source = sourceFilter) => {
      setLoading(true);
      try {
        const params: any = { page: p, limit };
        if (source) {
          params.source = source;
        }
        const { data } = await apiClient.get<OrdersResponse>("/order", {
          params,
        });
        console.log(data?.data, "data");
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
    [page, limit, sourceFilter],
  );

  useEffect(() => {
    load(1, sourceFilter);
    setPage(1);
  }, [sourceFilter]);

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(items, { resourceIDResolver: (i) => i._id });

  const askCancel = useCallback((item: Item) => {
    setTarget(item);
    setModalOpen(true);
  }, []);

  const showDetails = useCallback((item: Item) => {
    setTarget(item);
    setDetailModalOpen(true);
  }, []);

  const confirmCancel = useCallback(async () => {
    if (!target) return;
    setActionBusy(target._id);
    try {
      await apiClient.put(`/order/${target._id}`, { isActive: false });
      await load(page, sourceFilter);
      selectedResources.length = 0;
    } finally {
      setActionBusy(null);
      setTarget(null);
      setModalOpen(false);
    }
  }, [target, load, page, sourceFilter, selectedResources.length]);

  const handlePageChange = useCallback(
    (newPage: number) => {
      setPage(newPage);
      load(newPage, sourceFilter);
    },
    [load, sourceFilter],
  );

  const headings = useMemo(
    () => [
      { title: "Customer" },
      { title: "Subscription" },
      { title: "Active" },
      { title: "Street address" },
      { title: "Source" },
      { title: "Created at" },
      { title: "Next order" },
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
      subtitle="Customers with orders in the past 30 days"
    >
      <LegacyCard>
        <div style={{ padding: "16px", borderBottom: "1px solid #e1e1e1" }}>
          <InlineStack gap="400" align="space-between" blockAlign="center">
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
            {filteredBy && (
              <Badge tone="info">
                Filtered: {filteredBy} ({total as any} orders)
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
                No subscriptions found.
              </Text>
            </BlockStack>
          }
        >
          {items?.map((item, index) => {
            const createdAt = item.lastRenewAt
              ? new Date(item.lastRenewAt)
              : null;
            const nextOrder = createdAt ? addDays(createdAt, 30) : null;
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
                      item.subscription === "monthly" ? "success" : "attention"
                    }
                  >
                    {item.subscription || "—"}
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
                    {createdAt ? fmt.format(createdAt) : "—"}
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
        <BlockStack gap="200">
          <Text as="p">
            This stops future renewals for{" "}
            <Text as="span" fontWeight="semibold">
              {target ? `${target.firstName} ${target.lastName}` : ""}
            </Text>
            .
          </Text>
        </BlockStack>
      </Modal>

      {/* Improved Detail Modal */}
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
              {/* Header with Avatar and Name */}
              <Box
                padding="400"
                background="bg-surface-secondary"
                borderRadius="200"
              >
                <InlineStack gap="400" align="center" wrap={false}>
                  <Avatar
                    size="lg"
                    name={`${target.firstName} ${target.lastName}`}
                    source={undefined}
                  />
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingLg" fontWeight="bold">
                      {target.firstName} {target.lastName}
                    </Text>
                    <InlineStack gap="200">
                      <Badge tone={target.isActive ? "success" : "critical"}>
                        {target.isActive ? "Active" : "Inactive"}
                      </Badge>
                      <Badge
                        tone={
                          target.subscription === "monthly"
                            ? "success"
                            : "attention"
                        }
                      >
                        {target.subscription}
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

              {/* Contact Information */}
              <Box>
                <InlineStack gap="200" align="center">
                  <Icon source={EmailIcon} tone="base" />
                  <Text as="h3" variant="headingMd" fontWeight="semibold">
                    Contact Information
                  </Text>
                </InlineStack>
                <Divider />
                <Box paddingBlockStart="300">
                  <BlockStack gap="200">
                    <InlineStack gap="400" wrap>
                      <Box
                        padding="200"
                        background="bg-surface-secondary"
                        borderRadius="200"
                      >
                        <Text as="p" tone="subdued" variant="bodySm">
                          Email Address
                        </Text>
                        <Text as="p" variant="bodyMd" fontWeight="medium">
                          {target.email}
                        </Text>
                      </Box>
                      <Box
                        padding="200"
                        background="bg-surface-secondary"
                        borderRadius="200"
                      >
                        <Text as="p" tone="subdued" variant="bodySm">
                          Customer ID
                        </Text>
                        <Text as="p" variant="bodyMd" fontWeight="medium">
                          {target._id.slice(-8)}
                        </Text>
                      </Box>
                    </InlineStack>
                  </BlockStack>
                </Box>
              </Box>

              {/* Address Information */}
              <Box>
                <InlineStack gap="200" align="center">
                  <Icon source={MegaphoneIcon} tone="base" />
                  <Text as="h3" variant="headingMd" fontWeight="semibold">
                    Address Information
                  </Text>
                </InlineStack>
                <Divider />
                <Box paddingBlockStart="300">
                  <Grid columns={{ sm: 2 }}>
                    <Grid.Cell>
                      <Box
                        padding="200"
                        background="bg-surface-secondary"
                        borderRadius="200"
                      >
                        <Text as="p" tone="subdued" variant="bodySm">
                          Street Address
                        </Text>
                        <Text as="p" variant="bodyMd" fontWeight="medium">
                          {target.streetAddress}
                        </Text>
                        {target.streetAddress2 && (
                          <Text as="p" variant="bodyMd">
                            {target.streetAddress2}
                          </Text>
                        )}
                        <Text as="p" variant="bodyMd">
                          {target.postCode}
                        </Text>
                      </Box>
                    </Grid.Cell>
                    {target.normalizedAddress && (
                      <Grid.Cell>
                        <Box
                          padding="200"
                          background="bg-surface-secondary"
                          borderRadius="200"
                        >
                          <Text as="p" tone="subdued" variant="bodySm">
                            Normalized Address
                          </Text>
                          <Text as="p" variant="bodyMd">
                            {target.normalizedAddress}
                          </Text>
                          {target.normalizedAddress2 && (
                            <Text as="p" variant="bodyMd">
                              {target.normalizedAddress2}
                            </Text>
                          )}
                        </Box>
                      </Grid.Cell>
                    )}
                  </Grid>
                </Box>
              </Box>

              {/* Demographics Section */}
              {target.demographics &&
                Object.keys(target.demographics).some(
                  (key) => target.demographics?.[key as keyof Demographics],
                ) && (
                  <Box>
                    <InlineStack gap="200" align="center">
                      <Icon source={ProfileIcon} tone="base" />
                      <Text as="h3" variant="headingMd" fontWeight="semibold">
                        Demographics
                      </Text>
                    </InlineStack>
                    <Divider />
                    <Box paddingBlockStart="300">
                      <Grid columns={{ sm: 2, md: 3, lg: 4 }}>
                        {target.demographics.age && (
                          <Grid.Cell>
                            <Box
                              padding="200"
                              background="bg-surface-secondary"
                              borderRadius="200"
                            >
                              <Text as="p" tone="subdued" variant="bodySm">
                                Age
                              </Text>
                              <Text as="p" variant="bodyMd" fontWeight="medium">
                                {target.demographics.age}
                              </Text>
                            </Box>
                          </Grid.Cell>
                        )}
                        {target.demographics.gender && (
                          <Grid.Cell>
                            <Box
                              padding="200"
                              background="bg-surface-secondary"
                              borderRadius="200"
                            >
                              <Text as="p" tone="subdued" variant="bodySm">
                                Gender
                              </Text>
                              <Text as="p" variant="bodyMd" fontWeight="medium">
                                {target.demographics.gender}
                              </Text>
                            </Box>
                          </Grid.Cell>
                        )}
                        {target.demographics.identity && (
                          <Grid.Cell>
                            <Box
                              padding="200"
                              background="bg-surface-secondary"
                              borderRadius="200"
                            >
                              <Text as="p" tone="subdued" variant="bodySm">
                                Identity
                              </Text>
                              <Text as="p" variant="bodyMd" fontWeight="medium">
                                {target.demographics.identity}
                              </Text>
                            </Box>
                          </Grid.Cell>
                        )}
                        {target.demographics.household_size && (
                          <Grid.Cell>
                            <Box
                              padding="200"
                              background="bg-surface-secondary"
                              borderRadius="200"
                            >
                              <Text as="p" tone="subdued" variant="bodySm">
                                Household Size
                              </Text>
                              <Text as="p" variant="bodyMd" fontWeight="medium">
                                {target.demographics.household_size}
                              </Text>
                            </Box>
                          </Grid.Cell>
                        )}
                        {target.demographics.ethnicity && (
                          <Grid.Cell>
                            <Box
                              padding="200"
                              background="bg-surface-secondary"
                              borderRadius="200"
                            >
                              <Text as="p" tone="subdued" variant="bodySm">
                                Ethnicity
                              </Text>
                              <Text as="p" variant="bodyMd" fontWeight="medium">
                                {target.demographics.ethnicity}
                              </Text>
                            </Box>
                          </Grid.Cell>
                        )}
                        {target.demographics.household_language && (
                          <Grid.Cell>
                            <Box
                              padding="200"
                              background="bg-surface-secondary"
                              borderRadius="200"
                            >
                              <Text as="p" tone="subdued" variant="bodySm">
                                Language
                              </Text>
                              <Text as="p" variant="bodyMd" fontWeight="medium">
                                {target.demographics.household_language}
                              </Text>
                            </Box>
                          </Grid.Cell>
                        )}
                        {target.demographics.identifyAsLGBTQ && (
                          <Grid.Cell>
                            <Box
                              padding="200"
                              background="bg-surface-secondary"
                              borderRadius="200"
                            >
                              <Text as="p" tone="subdued" variant="bodySm">
                                LGBTQ+
                              </Text>
                              <Text as="p" variant="bodyMd" fontWeight="medium">
                                {target.demographics.identifyAsLGBTQ}
                              </Text>
                            </Box>
                          </Grid.Cell>
                        )}
                        {target.demographics.wehoHearAboutUs && (
                          <Grid.Cell>
                            <Box
                              padding="200"
                              background="bg-surface-secondary"
                              borderRadius="200"
                            >
                              <Text as="p" tone="subdued" variant="bodySm">
                                How They Heard
                              </Text>
                              <Text as="p" variant="bodyMd" fontWeight="medium">
                                {target.demographics.wehoHearAboutUs}
                              </Text>
                            </Box>
                          </Grid.Cell>
                        )}
                      </Grid>
                    </Box>
                  </Box>
                )}

              {/* Order Information */}
              <Box>
                <InlineStack gap="200" align="center">
                  <Icon source={CalendarIcon} tone="base" />
                  <Text as="h3" variant="headingMd" fontWeight="semibold">
                    Order Timeline
                  </Text>
                </InlineStack>
                <Divider />
                <Box paddingBlockStart="300">
                  <Grid columns={{ sm: 3 }}>
                    <Grid.Cell>
                      <Box
                        padding="200"
                        background="bg-surface-secondary"
                        borderRadius="200"
                      >
                        <Text as="p" tone="subdued" variant="bodySm">
                          Created At
                        </Text>
                        <Text as="p" variant="bodyMd" fontWeight="medium">
                          {target.createdAt
                            ? fmt.format(new Date(target.createdAt))
                            : "—"}
                        </Text>
                      </Box>
                    </Grid.Cell>
                    <Grid.Cell>
                      <Box
                        padding="200"
                        background="bg-surface-secondary"
                        borderRadius="200"
                      >
                        <Text as="p" tone="subdued" variant="bodySm">
                          Last Renewed
                        </Text>
                        <Text as="p" variant="bodyMd" fontWeight="medium">
                          {target.lastRenewAt
                            ? fmt.format(new Date(target.lastRenewAt))
                            : "—"}
                        </Text>
                      </Box>
                    </Grid.Cell>
                    <Grid.Cell>
                      <Box
                        padding="200"
                        background="bg-surface-secondary"
                        borderRadius="200"
                      >
                        <Text as="p" tone="subdued" variant="bodySm">
                          Next Order
                        </Text>
                        <Text as="p" variant="bodyMd" fontWeight="medium">
                          {target.lastRenewAt
                            ? fmt.format(
                                addDays(new Date(target.lastRenewAt), 30),
                              )
                            : "—"}
                        </Text>
                      </Box>
                    </Grid.Cell>
                  </Grid>
                </Box>
              </Box>

              {/* Product Information */}
              {target.productId && (
                <Box>
                  <InlineStack gap="200" align="center">
                    <Icon source={ProductIcon} tone="base" />
                    <Text as="h3" variant="headingMd" fontWeight="semibold">
                      Product Information
                    </Text>
                  </InlineStack>
                  <Divider />
                  <Box paddingBlockStart="300">
                    <Box
                      padding="200"
                      background="bg-surface-secondary"
                      borderRadius="200"
                    >
                      <Text as="p" tone="subdued" variant="bodySm">
                        Product ID
                      </Text>
                      <Text as="p" variant="bodyMd" fontWeight="medium">
                        {target.productId}
                      </Text>
                    </Box>
                  </Box>
                </Box>
              )}
            </BlockStack>
          </Box>
        )}
      </Modal>
    </Page>
  );
};

export default Subscription;
