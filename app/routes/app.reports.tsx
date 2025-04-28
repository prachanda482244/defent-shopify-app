import debounce from "lodash.debounce";
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
      <Text as="span" fontWeight="bold">
        {report.medication}
      </Text>
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
            placeholder="Search medication..."
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
            selectedReport ? "w-2/3" : "w-full"
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
          <div className="w-1/2 bg-white border rounded-md p-4 shadow-md">
            <div className="flex justify-between items-center mb-4">
              <Text as="p" variant="headingMd">
                Report Details
              </Text>
              <Button onClick={() => setSelectedReport(null)} size="slim">
                Close
              </Button>
            </div>
            <div className="space-y-2">
              <p>
                <strong>Medication:</strong> {selectedReport.medication}
              </p>
              <p>
                <strong>Age:</strong> {selectedReport.age}
              </p>
              <p>
                <strong>State:</strong> {selectedReport.state}
              </p>
              <p>
                <strong>City:</strong> {selectedReport.city}
              </p>
              <p>
                <strong>IP Address:</strong> {selectedReport.ipAddress}
              </p>
              <p>
                <strong>Submitted On:</strong>{" "}
                {new Date(selectedReport.createdAt).toLocaleDateString()}
              </p>
              <p>
                <strong>Status:</strong> {selectedReport.isQualify}
              </p>
            </div>
          </div>
        )}
      </div>
    </Page>
  );
}
