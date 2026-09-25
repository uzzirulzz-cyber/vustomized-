/** PlayBeat authority-control permission catalogue (mirrors the DB). */
export const PERMISSION_GROUPS: { group: string; permissions: { key: string; label: string }[] }[] = [
  { group: "General", permissions: [{ key: "dashboard.read", label: "View dashboard" }] },
  {
    group: "Orders",
    permissions: [
      { key: "orders.read", label: "View orders" },
      { key: "orders.manage", label: "Manage orders" },
    ],
  },
  {
    group: "Products",
    permissions: [
      { key: "products.read", label: "View products" },
      { key: "products.manage", label: "Manage products" },
    ],
  },
  {
    group: "Customers",
    permissions: [
      { key: "customers.read", label: "View customers" },
      { key: "customers.manage", label: "Manage customers" },
    ],
  },
  {
    group: "Finance",
    permissions: [
      { key: "payments.read", label: "View payments" },
      { key: "payments.manage", label: "Manage payments" },
      { key: "refunds.read", label: "View refunds" },
      { key: "refunds.approve", label: "Approve refunds" },
      { key: "analytics.read", label: "View analytics" },
    ],
  },
  {
    group: "Messages",
    permissions: [
      { key: "messages.read", label: "View messages" },
      { key: "messages.reply", label: "Reply to messages" },
      { key: "messages.manage", label: "Assign & close chats" },
    ],
  },
  {
    group: "Authority",
    permissions: [
      { key: "staff.read", label: "View staff" },
      { key: "staff.manage", label: "Manage staff" },
      { key: "roles.read", label: "View roles" },
      { key: "roles.manage", label: "Edit role permissions" },
    ],
  },
  {
    group: "Security",
    permissions: [
      { key: "audit.read", label: "View audit log" },
      { key: "settings.manage", label: "Manage settings" },
    ],
  },
];

export const ALL_PERMISSION_KEYS = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key));

export function can(permissions: string[] | undefined, key: string): boolean {
  return !!permissions?.includes(key);
}
