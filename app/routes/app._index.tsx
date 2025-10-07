import { DeleteIcon } from "@shopify/polaris-icons";
import {
  TextField,
  IndexTable,
  LegacyCard,
  IndexFilters,
  useSetIndexFiltersMode,
  useIndexResourceState,
  Text,
  Page,
  Badge,
  useBreakpoints,
  Select,
  ChoiceList,
  Button,
} from "@shopify/polaris";
import type { IndexFiltersProps, TabProps } from "@shopify/polaris";
import apiClient from "app/config/AxiosInstance";
import { useState, useCallback, useEffect } from "react";
import debounce from "lodash.debounce";
import { Modal } from "@shopify/app-bridge-react";
import { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "app/shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  console.log(session, "session");

  return null;
};
function disambiguateLabel(key: string, value: string | any[]): string {
  switch (key) {
    case "ageGroup":
      return (value as string[]).map((val) => `Age: ${val}`).join(", ");
    case "medication":
      return `Medication:${value}`;
    case "status":
      return `Status: ${value}`;
    case "state":
      return `State:${value}`;

    default:
      return value as string;
  }
}

function isEmpty(value: string | string[]): boolean {
  if (Array.isArray(value)) {
    return value.length === 0;
  } else {
    return value === "" || value == null;
  }
}

const actionOptions = [
  { label: "New", value: "new" },
  // { label: "Auto Approved", value: "auto-approved" },
  { label: "Approved", value: "approved" },
  { label: "Rejected", value: "rejected" },
  { label: "Delete Report", value: "delete" },
];
interface ReportProps {
  _id: string;
  age: string;
  city: string;
  createdAt: string;
  ipAddress: string;
  isQualify: string;
  medication: string;
  state: string;
  source?: string;
  image: string;
}

interface ApiResponse {
  statusCode: number;
  data: {
    metadata: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
      hasNextPage: boolean;
      hasPrevPage: boolean;
    };
    reports: ReportProps[];
  };
}
const Testing = () => {
  const [reports, setReports] = useState<ReportProps[]>([]),
    [loading, setLoading] = useState<boolean>(false),
    [activeButton, setActiveButton] = useState<string>("all"),
    [page, setPage] = useState<number>(1),
    [totalPages, setTotalPages] = useState<number>(1),
    [selectedReport, setSelectedReport] = useState<ReportProps | null>(null),
    [refresh, setRefresh] = useState<boolean>(false),
    [searchQuery, setSearchQuery] = useState<string>("");
  const [selected, setSelected] = useState(0);

  const { mode, setMode } = useSetIndexFiltersMode();
  const onHandleCancel = () => {};

  const [medication, setMedication] = useState<string | undefined>("");
  const [ageGroup, setAgeGroup] = useState<string[] | undefined>([]);
  const [state, setState] = useState("");
  const [filterStatus, setFilterStatus] = useState<string | undefined>("");
  const [queryValue, setQueryValue] = useState("");
  const fetchReports = async (currentPage: number, query: string = "") => {
    try {
      setLoading(true);
      let activeReport: any[] = [];
      if (activeButton === "approved") {
        const { data } = await apiClient.get<ApiResponse>(
          `/admin/reports?limit=15&page=${currentPage}&filter=approved`,
        );
        activeReport = data?.data?.reports;
      }
      const { data } = await apiClient.get<ApiResponse>(
        `/admin/reports?limit=15&page=${currentPage}&filter=${activeButton === "approved" && !activeReport?.length ? "auto-approved" : activeButton}&q=${query}&state=${state}&medication=${medication}&age=${ageGroup}&status=${filterStatus}`,
      );
      if (data?.statusCode === 200) {
        setReports(data?.data.reports);
        setTotalPages(data?.data?.metadata.totalPages);
      }
    } catch (error) {
      console.error("Error fetching reports", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports(page, searchQuery);
  }, [page, activeButton, state, medication, ageGroup, filterStatus, refresh]);

  const [itemStrings] = useState([
    "All",
    "New",
    "Approved",
    "Rejected",
    // "Source",
  ]);

  const handleDelete = async (id: string) => {
    const confirmDelete = confirm(
      "Are you sure you want to delete this entry ?",
    );
    if (!confirmDelete) return;
    try {
      const { data } = await apiClient.delete(`/admin/reports/${id}`);
      if (data?.statusCode === 200) {
        shopify.toast.show(data?.message || "Report deleted");
      }
      setReports((prev) => prev.filter((report) => report._id !== id));
      if (selectedReport?._id === id) {
        setSelectedReport(null);
      }
    } catch (error) {
      console.error("Error deleting report", error);
    }
  };
  const handleQualifyChange = async (id: string, newValue: string) => {
    if (newValue === "delete") {
      handleDelete(id);
    } else {
      try {
        await apiClient.put(`/admin/request-approval/${id}`, {
          isApproved: newValue,
        });
        setReports((prev) =>
          prev.map((report) =>
            report._id === id ? { ...report, isQualify: newValue } : report,
          ),
        );
      } catch (error) {
        console.error("Error updating qualify status", error);
      }
    }
  };
  const tabs: TabProps[] = itemStrings.map((item, index) => ({
    content: item,
    index,
    onAction: () => {
      setActiveButton(item.toLowerCase());
    },
    id: `${item}-${index}`,
  }));

  const handleMedicationChange = useCallback(
    (value: string) => setMedication(value),
    [],
  );

  const handleFilterStatusChange = useCallback((value: string) => {
    setFilterStatus(value);
  }, []);
  const handleAgeGroupChange = useCallback((value: string[]) => {
    setAgeGroup(value);
  }, []);

  const handleStateChange = useCallback((value: string) => setState(value), []);
  const debouncedSearch = useCallback(
    debounce((value: string) => {
      fetchReports(1, value);
    }, 500),
    [],
  );
  const handleFiltersQueryChange = (value: string) => {
    setQueryValue(value);
    debouncedSearch(value);
  };

  //   const handleFiltersQueryChange = useCallback(
  //     (value: string) => setQueryValue(value),
  //     [],
  //   );
  const handleMedicationStatusRemove = useCallback(() => setMedication(""), []);
  const handleFilterStatusRemove = useCallback(() => setFilterStatus(""), []);
  const handleAgeGroupStatusRemove = useCallback(() => setAgeGroup([]), []);
  const handleStateRemove = useCallback(() => handleStateChange(""), []);
  const handleQueryValueRemove = useCallback(() => setQueryValue(""), []);
  const handleFiltersClearAll = useCallback(() => {
    handleMedicationStatusRemove();
    handleAgeGroupStatusRemove();
    handleFilterStatusRemove();
    handleStateRemove();
    handleQueryValueRemove();
  }, [
    handleMedicationStatusRemove,
    handleAgeGroupStatusRemove,
    handleFilterStatusRemove,
    handleStateRemove,
    handleQueryValueRemove,
  ]);

  const filters = [
    {
      key: "ageGroup",
      label: "Age group",
      filter: (
        <ChoiceList
          title="Age Group"
          titleHidden
          choices={[
            { label: "18-25", value: "18-25" },
            { label: "26-34", value: "26-34" },
            { label: "35-45", value: "35-45" },
            { label: "46+", value: "46+" },
          ]}
          selected={ageGroup || []}
          onChange={handleAgeGroupChange}
        />
      ),
      shortcut: true,
    },
    {
      key: "medication",
      label: "Medication",
      filter: (
        <TextField
          label="Medication"
          value={medication}
          onChange={handleMedicationChange}
          autoComplete="off"
          labelHidden
        />
      ),
      shortcut: true,
    },
    {
      key: "state",
      label: "State",
      filter: (
        <TextField
          label="State"
          value={state}
          onChange={handleStateChange}
          autoComplete="off"
          labelHidden
        />
      ),
      shortcut: true,
    },

    {
      key: "status",
      label: "Status",
      filter: (
        <Select
          label=""
          onChange={handleFilterStatusChange}
          value={filterStatus}
          labelHidden
          options={actionOptions}
        />
      ),
      shortcut: true,
    },
  ];

  const appliedFilters: IndexFiltersProps["appliedFilters"] = [];
  if (medication) {
    const key = "medication";
    appliedFilters.push({
      key,
      label: disambiguateLabel(key, medication),
      onRemove: handleMedicationStatusRemove,
    });
  }
  if (ageGroup && !isEmpty(ageGroup)) {
    const key = "ageGroup";
    appliedFilters.push({
      key,
      label: disambiguateLabel(key, ageGroup),
      onRemove: handleAgeGroupStatusRemove,
    });
  }
  if (state) {
    const key = "state";
    appliedFilters.push({
      key,
      label: disambiguateLabel(key, state),
      onRemove: handleStateRemove,
    });
  }
  if (filterStatus) {
    const key = "status";
    appliedFilters.push({
      key,
      label: disambiguateLabel(key, filterStatus),
      onRemove: handleFilterStatusRemove,
    });
  }

  const resourceName = {
    singular: "report",
    plural: "reports",
  };

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState([]);

  const rowMarkup = reports.map(
    (
      {
        _id,
        age,
        ipAddress,
        city,
        createdAt,
        image,
        isQualify,
        medication,
        state,
        source,
      },
      index,
    ) => (
      <IndexTable.Row
        id={_id}
        key={_id}
        selected={selectedResources.includes(_id)}
        position={index}
        disabled={loading}
      >
        <IndexTable.Cell>
          <Text variant="bodyMd" fontWeight="bold" as="span">
            {medication}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>{age}</IndexTable.Cell>
        <IndexTable.Cell>{state}</IndexTable.Cell>
        <IndexTable.Cell>{city}</IndexTable.Cell>

        <IndexTable.Cell>
          {new Date(createdAt).toLocaleDateString()}
        </IndexTable.Cell>
        <IndexTable.Cell>{source || "defent.com"}</IndexTable.Cell>
        <IndexTable.Cell>
          <Badge
            tone={
              isQualify === "approved"
                ? `success`
                : isQualify === "rejected"
                  ? "critical"
                  : isQualify == "new"
                    ? "info-strong"
                    : "warning"
            }
          >
            {isQualify}
          </Badge>
        </IndexTable.Cell>

        <IndexTable.Cell>
          <Select
            label=""
            value={isQualify}
            options={actionOptions}
            disabled={isQualify === "auto-approved"}
            onChange={(newValue) => handleQualifyChange(_id, newValue)}
          />
        </IndexTable.Cell>
        <IndexTable.Cell>
          {" "}
          <Button
            onClick={() => {
              setSelectedReport({
                _id,
                age,
                city,
                createdAt,
                image,
                ipAddress,
                isQualify,
                medication,
                state,
                source,
              });
              shopify.modal.show("display-modal");
            }}
          >
            View
          </Button>
        </IndexTable.Cell>
      </IndexTable.Row>
    ),
  );
  const bulkActions = [
    {
      icon: DeleteIcon,
      destructive: true,
      content: "Delete",
      onAction: async () => {
        try {
          const confirmDelete = confirm("Are you sure you want to delete ?");
          if (!confirmDelete) return;
          const { data } = await apiClient.delete("/admin/bulk/delete", {
            data: {
              ids: selectedResources,
            },
          });
          console.log(data, "data");
          if (data?.statusCode === 200) {
            shopify.toast.show(data?.message || "All entries deleted");
            setRefresh(!refresh);
          }
        } catch (error) {
          shopify.toast.show("Error while deleting");
        }
      },
    },
  ];

  return (
    <Page title="Reports">
      <div className="relative">
        <div className="absolute bottom-3 z-[999] right-6">
          <Text as="span" variant="bodySm">
            Page {page} of {totalPages}
          </Text>
        </div>
        <LegacyCard>
          <IndexFilters
            loading={loading}
            queryValue={queryValue}
            queryPlaceholder="Searching in all"
            onQueryChange={handleFiltersQueryChange}
            onQueryClear={() => setQueryValue("")}
            cancelAction={{
              onAction: onHandleCancel,
              disabled: false,
              loading: false,
            }}
            tabs={tabs}
            selected={selected}
            onSelect={setSelected}
            filters={filters}
            appliedFilters={appliedFilters}
            onClearAll={handleFiltersClearAll}
            mode={mode}
            isFlushWhenSticky
            setMode={setMode}
            canCreateNewView={false}
          />
          <IndexTable
            // condensed={useBreakpoints().smDown}
            resourceName={resourceName}
            itemCount={reports.length}
            selectedItemsCount={
              allResourcesSelected ? "All" : selectedResources.length
            }
            onSelectionChange={handleSelectionChange}
            headings={[
              { title: "Medication" },
              { title: "Age" },
              { title: "State" },
              { title: "City" },

              { title: "Submitted On" },
              { title: "Source" },
              { title: "Status" },
              { title: "Action" },
              { title: "View" },
            ]}
            bulkActions={bulkActions}
            pagination={{
              hasPrevious: page > 1,
              onPrevious: () => setPage((prev) => Math.max(prev - 1, 1)),
              hasNext: page < totalPages,
              onNext: () => setPage((prev) => Math.min(prev + 1, totalPages)),
            }}
          >
            {rowMarkup}
          </IndexTable>

          {selectedReport && (
            <Modal id="display-modal">
              <div className="w-full bg-white border rounded-lg p-6 shadow-lg space-y-6">
                <div className="flex justify-between items-center">
                  <Text as="h2" variant="headingMd">
                    Report Details
                  </Text>
                  <div className="flex items-center gap-2">
                    <Button
                      tone="critical"
                      size="slim"
                      onClick={() => handleDelete(selectedReport?._id)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-3 md:grid-cols-4 gap-4 text-sm">
                  <p>
                    <span className="font-semibold">Medication:</span>{" "}
                    {selectedReport.medication}
                  </p>
                  <p>
                    <span className="font-semibold">Age:</span>{" "}
                    {selectedReport.age}
                  </p>
                  <p>
                    <span className="font-semibold">State:</span>{" "}
                    {selectedReport.state}
                  </p>
                  <p>
                    <span className="font-semibold">City:</span>{" "}
                    {selectedReport.city}
                  </p>
                  <p>
                    <span className="font-semibold">IP Address:</span>{" "}
                    {selectedReport.ipAddress}
                  </p>
                  <p>
                    <span className="font-semibold">Submitted On:</span>{" "}
                    {new Date(selectedReport.createdAt).toLocaleDateString()}
                  </p>
                  <p>
                    <span className="font-semibold">Status:</span>{" "}
                    <Badge
                      tone={
                        selectedReport?.isQualify === "approved"
                          ? `success`
                          : selectedReport?.isQualify === "rejected"
                            ? "critical"
                            : selectedReport?.isQualify == "new"
                              ? "info-strong"
                              : "warning"
                      }
                    >
                      {selectedReport.isQualify}
                    </Badge>
                  </p>
                  <p>
                    <span className="font-semibold">Source:</span>
                    {selectedReport?.source || "defent.com"}
                  </p>
                </div>
                <div className="w-full flex justify-center">
                  <img
                    src={
                      selectedReport?.image ||
                      "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                    }
                    alt="Report"
                    className="max-w-[300px] max-h-[300px] object-cover rounded-md shadow"
                  />
                </div>
              </div>
            </Modal>
          )}
        </LegacyCard>
      </div>
    </Page>
  );
};

export default Testing;
