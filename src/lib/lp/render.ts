// Lead Pulse — template variable rendering ({{first_name}} etc.) + detection.
export const TEMPLATE_VARIABLES = [
  "first_name",
  "last_name",
  "company",
  "country",
  "city",
  "employee_name",
  "phone",
  "email",
] as const;

export function detectVariables(body: string): string[] {
  const found = new Set<string>();
  for (const m of body.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
    found.add(m[1].toLowerCase());
  }
  return [...found];
}

export type RenderContext = {
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  country?: string | null;
  city?: string | null;
  employeeName?: string | null;
  phone?: string | null;
  email?: string | null;
};

export function renderTemplate(body: string, ctx: RenderContext): string {
  const map: Record<string, string> = {
    first_name: ctx.firstName || "there",
    last_name: ctx.lastName || "",
    company: ctx.company || "your company",
    country: ctx.country || "",
    city: ctx.city || "",
    employee_name: ctx.employeeName || "PlayBeat Team",
    phone: ctx.phone || "",
    email: ctx.email || "",
  };
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    const v = map[key.toLowerCase()];
    return v !== undefined ? v : `{{${key}}}`;
  });
}
