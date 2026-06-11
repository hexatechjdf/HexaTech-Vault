// Tab registry — TS-side mirror of migration 0026's `tab_name` and `tab_level`
// enums. Adding a tab here = also adding it to the SQL enum (otherwise the
// two halves of the engine disagree and `get_effective_tab_level` will fail).

export const TAB_NAMES = [
  "user_management",
  "folder_access",
  "file_manager",
  "audit_logs",
  "storage_overview",
  "settings",
] as const;

export type TabName = (typeof TAB_NAMES)[number];

export const TAB_LABELS: Record<TabName, string> = {
  user_management: "User Management",
  folder_access: "Folder Access Control",
  file_manager: "File Manager",
  audit_logs: "Audit Logs",
  storage_overview: "Storage Overview",
  settings: "Settings",
};

export const TAB_ROUTES: Record<TabName, string> = {
  user_management: "/users",
  folder_access: "/folders",
  file_manager: "/files",
  audit_logs: "/audit",
  storage_overview: "/storage",
  settings: "/settings",
};

// Reverse map for middleware: route prefix -> tab name. The middleware checks
// `pathname.startsWith(route)` so this map's keys match what's in TAB_ROUTES.
export const ROUTE_TO_TAB: Record<string, TabName> = Object.entries(TAB_ROUTES)
  .reduce<Record<string, TabName>>((acc, [tab, route]) => {
    acc[route] = tab as TabName;
    return acc;
  }, {});

export const TAB_LEVELS = ["no_access", "view", "action"] as const;
export type TabLevel = (typeof TAB_LEVELS)[number];

export const TAB_LEVEL_LABELS: Record<TabLevel, string> = {
  no_access: "No Access",
  view: "View Only",
  action: "View + Action",
};

// Numeric rank — useful for "user has AT LEAST view" comparisons in the UI.
const TAB_LEVEL_RANK: Record<TabLevel, number> = {
  no_access: 0,
  view: 1,
  action: 2,
};

/** True if `actual` meets or exceeds `required`. */
export function tabLevelMeets(actual: TabLevel | undefined, required: TabLevel): boolean {
  if (!actual) return required === "no_access";
  return TAB_LEVEL_RANK[actual] >= TAB_LEVEL_RANK[required];
}
