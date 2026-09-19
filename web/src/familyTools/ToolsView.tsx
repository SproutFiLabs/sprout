import type { ReactNode } from "react";
import type {
  AssetPassport,
  FamilyPlan,
  InvestmentProvider,
  LedgerEntry,
  ToolsData,
} from "@sprout/shared";
import { ToolsWorkspace } from "./ToolsWorkspace";
import "./tools.css";
import "./workspace.css";
export type ToolPage = "home" | "rewards" | "tax" | "passports" | "investing";
export const TOOL_PATHS: Record<ToolPage, string> = {
  home: "/family-tools",
  rewards: "/rewards",
  tax: "/tax-garden",
  passports: "/asset-passports",
  investing: "/family-investing",
};
export const money = (c: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    c / 100,
  );
export interface ToolsViewProps {
  page: ToolPage;
  wallet: string | null;
  busy: boolean;
  error: string;
  notice: string;
  data: ToolsData;
  passports: AssetPassport[];
  provider: InvestmentProvider | null;
  selectedAsset: string;
  search: string;
  year: string;
  ledgerFilter: string;
  onConnect: () => void;
  onLock: () => void;
  onRefresh: () => void;
  onSearch: (s: string) => void;
  onAsset: (s: string) => void;
  onYear: (s: string) => void;
  onFilter: (s: string) => void;
  onAdd: () => void;
  onImport: () => void;
  onTemplate: () => void;
  onExport: (advanced: boolean) => void;
  onEdit: (e: LedgerEntry) => void;
  onDelete: (e: LedgerEntry) => void;
  onSync: () => void;
  onConfirm: (id: string) => void;
  onPlan: (p: FamilyPlan) => void;
  onDeletePlan: () => void;
  onDownloadPlan: () => void;
  onProvider: () => void;
  assetUrl?: (s: string) => string;
  garden?: ReactNode;
}
export function ToolsView(props: ToolsViewProps) {
  return <ToolsWorkspace {...props} />;
}
