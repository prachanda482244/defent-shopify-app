import debounce from "lodash.debounce";
import { HideIcon, ViewIcon } from "@shopify/polaris-icons";
import {
  Card,
  DataTable,
  Page,
  Pagination,
  Select,
  Text,
  Badge,
  SkeletonBodyText,
  Button,
  TextField,
  Icon,
} from "@shopify/polaris";
import { useCallback, useEffect, useState } from "react";
import apiClient from "app/config/AxiosInstance";

interface ReportProps {
  _id: string;
  age: string;
  city: string;
  createdAt: string;
  ipAddress: string;
  isQualify: string;
  medication: string;
  state: string;
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

export default function ReportsTable() {
  const [reports, setReports] = useState<ReportProps[]>([]),
    buttons: string[] = ["all", "new", "approved", "rejected", "source"],
    [loading, setLoading] = useState<boolean>(false),
    [activeButton, setActiveButton] = useState<string>("all"),
    [page, setPage] = useState<number>(1),
    [totalPages, setTotalPages] = useState<number>(1),
    [selectedReport, setSelectedReport] = useState<ReportProps | null>(null),
    [searchQuery, setSearchQuery] = useState<string>("");

  const fetchReports = async (currentPage: number, query: string = "") => {
    try {
      setLoading(true);
      const { data } = await apiClient.get<ApiResponse>(
        `/admin/reports?page=${currentPage}&&filter=${activeButton}&&q=${query}`,
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

  const handleQualifyChange = async (id: string, newValue: string) => {
    if (newValue === "delete") {
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

  useEffect(() => {
    fetchReports(page, searchQuery);
  }, [page, activeButton]);

  const debouncedSearch = useCallback(
    debounce((value: string) => {
      fetchReports(1, value);
    }, 500),
    [],
  );

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    debouncedSearch(value);
  };
  const rows = reports.map((report) => [
    <div
      onClick={() => setSelectedReport(report)}
      className={`cursor-pointer ${
        selectedReport?._id === report._id ? "bg-gray-100" : ""
      }`}
    >
      <p className="flex items-center gap-2 ">
        <span className="">
          <Icon
            source={selectedReport?._id === report._id ? ViewIcon : HideIcon}
          />
        </span>
        <span className="font-bold w-full">{report.medication}</span>
      </p>
    </div>,
    report.age,
    report.state,
    report.city,
    report.ipAddress,
    new Date(report.createdAt).toLocaleDateString(),
    <Badge
      tone={
        report?.isQualify === "approved"
          ? `success`
          : report?.isQualify === "rejected"
            ? "critical"
            : report?.isQualify == "new"
              ? "info-strong"
              : "warning"
      }
    >
      {report.isQualify}
    </Badge>,
    <Select
      label=""
      options={[
        { label: "New", value: "new" },
        { label: "Auto Approved", value: "auto-approved" },
        { label: "Approved", value: "approved" },
        { label: "Rejected", value: "rejected" },
        { label: "Delete Report", value: "delete" },
      ]}
      value={report.isQualify}
      onChange={(newValue) => handleQualifyChange(report._id, newValue)}
    />,
  ]);
  return (
    <Page title="Reports">
      <div className="flex items-center justify-between py-2 gap-4">
        <div className="flex items-center gap-2">
          {buttons.map((button) => (
            <Button
              key={button}
              pressed={activeButton === button}
              onClick={() => setActiveButton(button)}
            >
              {button.toUpperCase()}
            </Button>
          ))}
        </div>
        <div className="w-64">
          <TextField
            clearButton
            label=""
            placeholder="Search here..."
            value={searchQuery}
            onChange={(value) => handleSearchChange(value)}
            autoComplete="off"
            onClearButtonClick={() => {
              setSearchQuery("");
              fetchReports(1, "");
            }}
          />
        </div>
      </div>

      <div className="flex gap-4">
        <div
          className={`transition-all ${
            selectedReport ? "w-[30%]" : "w-full"
          } duration-300`}
        >
          <Card>
            {loading ? (
              <SkeletonBodyText />
            ) : (
              <DataTable
                columnContentTypes={[
                  "text",
                  "text",
                  "text",
                  "text",
                  "text",
                  "text",
                  "text",
                  "text",
                ]}
                headings={[
                  "Medication",
                  "Age",
                  "State",
                  "City",
                  "IP Address",
                  "Submitted On",
                  "Status",
                  "Action",
                ]}
                rows={rows}
              />
            )}
            <div className="mt-4 flex flex-col items-center space-y-2">
              <Pagination
                hasPrevious={page > 1}
                onPrevious={() => setPage((prev) => Math.max(prev - 1, 1))}
                hasNext={page < totalPages}
                onNext={() => setPage((prev) => Math.min(prev + 1, totalPages))}
              />
              <Text as="span" variant="bodySm">
                Page {page} of {totalPages}
              </Text>
            </div>
          </Card>
        </div>

        {selectedReport && (
          <div className="w-[70%] bg-white border rounded-lg p-6 shadow-lg space-y-6">
            <div className="flex justify-between items-center">
              <Text as="h2" variant="headingMd">
                Report Details
              </Text>
              <div className="flex items-center gap-2">
                <Button tone="critical" size="slim" onClick={() => {}}>
                  Delete
                </Button>
                <Button size="slim" onClick={() => setSelectedReport(null)}>
                  Close
                </Button>
              </div>
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <p>
                <span className="font-semibold">Medication:</span>{" "}
                {selectedReport.medication}
              </p>
              <p>
                <span className="font-semibold">Age:</span> {selectedReport.age}
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
            </div>
          </div>
        )}
      </div>
    </Page>
  );
}
