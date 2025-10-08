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
} from "@shopify/polaris";

type Item = {
  _id: string;
  isActive: boolean;
  firstName: string;
  lastName: string;
  email: string;
  subscription: string;
  streetAddress: string;
  lastRenewAt: string; // use as createdAt
};

type OrdersResponse = {
  success: boolean;
  message: string;
  data: Item[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

const fmt = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "2-digit",
});
const addDays = (d: Date, n: number) =>
  new Date(d.getTime() + n * 24 * 60 * 60 * 1000);

const Subscription = () => {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [limit] = useState(15);
  const [totalPages, setTotalPages] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [target, setTarget] = useState<Item | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const load = useCallback(
    async (p = page) => {
      setLoading(true);
      try {
        const { data } = await apiClient.get<OrdersResponse>("/order", {
          params: { page: p, limit },
        });
        setItems(data?.data ?? []);
        setTotalPages(data?.totalPages ?? 1);
      } finally {
        setLoading(false);
      }
    },
    [page, limit],
  );

  useEffect(() => {
    load();
  }, [load]);

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(items, { resourceIDResolver: (i) => i._id });

  const askCancel = useCallback((item: Item) => {
    setTarget(item);
    setModalOpen(true);
  }, []);
  const confirmCancel = useCallback(async () => {
    if (!target) return;
    setActionBusy(target._id);
    try {
      await apiClient.put(`/order/${target._id}`, { isActive: false });
      await load(1);
      setPage(1);
      selectedResources.length = 0;
    } finally {
      setActionBusy(null);
      setTarget(null);
      setModalOpen(false);
    }
  }, [target, load]);

  const headings = useMemo(
    () => [
      { title: "Customer" }, // name + email stacked
      { title: "Subscription" },
      { title: "Active" },
      { title: "Street address" },
      { title: "Created at" }, // was “Last renew”
      { title: "Next order" }, // createdAt + 30 days
      { title: "Action" },
    ],
    [],
  );

  return (
    <Page title="Subscription" subtitle="Customers in the past 30 days">
      <LegacyCard>
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
          {items.map((item, index) => {
            const createdAt = item.lastRenewAt
              ? new Date(item.lastRenewAt)
              : null; // treat as createdAt
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
                  <Text as="span" variant="bodyMd">
                    {item.streetAddress || "—"}
                  </Text>
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
                      tone="critical"
                      disabled={!item.isActive || actionBusy === item._id}
                      loading={actionBusy === item._id}
                      onClick={() => askCancel(item)}
                    >
                      Cancel subscription
                    </Button>
                  </InlineStack>
                </IndexTable.Cell>
              </IndexTable.Row>
            );
          })}
        </IndexTable>

        <BlockStack inlineAlign="center">
          <Pagination
            hasPrevious={page > 1}
            onPrevious={() => {
              const p = Math.max(page - 1, 1);
              setPage(p);
              load(p);
            }}
            hasNext={page < totalPages}
            onNext={() => {
              const p = Math.min(page + 1, totalPages);
              setPage(p);
              load(p);
            }}
          />
          <Text tone="subdued" as="span">
            Page {page} of {totalPages}
          </Text>
        </BlockStack>
      </LegacyCard>

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
    </Page>
  );
};

export default Subscription;
