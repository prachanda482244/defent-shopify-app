/* ==================================================================== *
 *  app.address-check.tsx  — Address Checker (production admin tool)
 *
 *  Lets staff verify any address against the SAME pipeline the order
 *  form uses: Census geocode -> municipal boundary -> ZIP agreement ->
 *  household availability. Read-only: nothing is created or emailed.
 * ==================================================================== */
import { useCallback, useState } from "react";
import apiClient from "app/config/AxiosInstance";
import {
  Page,
  Layout,
  Card,
  TextField,
  Select,
  Button,
  Banner,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  DataTable,
  Box,
} from "@shopify/polaris";

type Verdict = {
  eligible: boolean;
  program?: string;
  normalized?: string;
  municipality?: string;
  mailingCity?: string;
  coordinates?: { x: number; y: number } | null;
  typedZip?: string;
  matchedZip?: string;
  reason?: string;
  message?: string;
  transient?: boolean;
  household?: {
    blocked: boolean;
    blockedUntil?: string;
    existingOrderId?: string;
    existingType?: string;
  };
};

const fmtDate = (d?: string) => (d ? new Date(d).toLocaleDateString() : "—");

export default function AddressCheck() {
  const [program, setProgram] = useState("defentLA");
  const [street, setStreet] = useState("");
  const [unit, setUnit] = useState("");
  const [zip, setZip] = useState("");
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [netError, setNetError] = useState("");

  const validate = useCallback(async () => {
    setBusy(true);
    setVerdict(null);
    setNetError("");
    try {
      const { data } = await apiClient.post("/order/validate-address", {
        streetAddress: street,
        streetAddress2: unit,
        postCode: zip,
        flag: program,
      });
      setVerdict(data?.data ?? { eligible: false, message: data?.message });
    } catch (e: any) {
      setNetError(
        e?.response?.status === 429
          ? "Too many checks in a short time — wait a few minutes."
          : "Could not reach the validation service.",
      );
    } finally {
      setBusy(false);
    }
  }, [street, unit, zip, program]);

  const rows =
    verdict && verdict.normalized
      ? [
          ["Verified address", verdict.normalized],
          ["Municipality (decides eligibility)", verdict.municipality || "—"],
          ["Mailing city (goes on the label)", verdict.mailingCity || "—"],
          [
            "ZIP check",
            verdict.matchedZip
              ? `typed ${verdict.typedZip} · Census ${verdict.matchedZip} ${
                  verdict.typedZip === verdict.matchedZip ? "✓" : "✗"
                }`
              : "—",
          ],
          [
            "Coordinates",
            verdict.coordinates
              ? `${verdict.coordinates.y?.toFixed(5)}, ${verdict.coordinates.x?.toFixed(5)}`
              : "—",
          ],
        ]
      : [];

  return (
    <Page
      title="Address Checker"
      subtitle="Verify an address exactly the way the order form does — nothing is created"
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Select
                label="Program"
                options={[
                  {
                    label: "Defent LA (City of Los Angeles)",
                    value: "defentLA",
                  },
                  {
                    label: "Defent WEHO (City of West Hollywood)",
                    value: "defentWeho",
                  },
                ]}
                value={program}
                onChange={setProgram}
              />
              <TextField
                label="Street address"
                value={street}
                onChange={setStreet}
                autoComplete="off"
                placeholder="14410 Sylvan St"
              />
              <InlineStack gap="300">
                <div style={{ flexGrow: 1 }}>
                  <TextField
                    label="Unit / Apt (optional)"
                    value={unit}
                    onChange={setUnit}
                    autoComplete="off"
                    placeholder="Apt 5"
                  />
                </div>
                <div style={{ width: 160 }}>
                  <TextField
                    label="ZIP"
                    value={zip}
                    onChange={setZip}
                    autoComplete="off"
                    placeholder="91401"
                    maxLength={5}
                  />
                </div>
              </InlineStack>
              <InlineStack>
                <Button
                  variant="primary"
                  loading={busy}
                  disabled={!street || zip.length !== 5}
                  onClick={validate}
                >
                  Validate address
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {netError && (
          <Layout.Section>
            <Banner tone="critical">{netError}</Banner>
          </Layout.Section>
        )}

        {verdict && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
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
                      ? `✓ Eligible for ${verdict.program}`
                      : verdict.transient
                        ? "Could not verify right now"
                        : `Not eligible for ${verdict.program || "this program"}`
                  }
                >
                  <p>{verdict.message}</p>
                </Banner>

                {rows.length > 0 && (
                  <DataTable
                    columnContentTypes={["text", "text"]}
                    headings={["Field", "Value"]}
                    rows={rows}
                  />
                )}

                {verdict.household && verdict.normalized && (
                  <Box>
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span" fontWeight="semibold">
                        Household availability:
                      </Text>
                      {verdict.household.blocked ? (
                        <Badge tone="attention">
                          {`Blocked until ${fmtDate(verdict.household.blockedUntil)} — ${verdict.household.existingType || "existing order"} at this address`}
                        </Badge>
                      ) : (
                        <Badge tone="success">Can order now</Badge>
                      )}
                    </InlineStack>
                  </Box>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
