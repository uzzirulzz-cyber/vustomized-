import type { MetadataRoute } from "next";
import { db } from "@/lib/db";

const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://playbeat.digital";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const statics: MetadataRoute.Sitemap = [
    { url: `${SITE}/`, changeFrequency: "daily", priority: 1 },
    { url: `${SITE}/products`, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE}/categories`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE}/subscriptions`, changeFrequency: "daily", priority: 0.85 },
    { url: `${SITE}/offers`, changeFrequency: "daily", priority: 0.85 },
    { url: `${SITE}/projector-comparison`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE}/support`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE}/support/warranty-replacement`, changeFrequency: "yearly", priority: 0.4 },
    { url: `${SITE}/support/refund-policy`, changeFrequency: "yearly", priority: 0.4 },
    { url: `${SITE}/support/privacy-policy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE}/support/terms-of-service`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE}/contact`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE}/signin`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE}/signup`, changeFrequency: "yearly", priority: 0.3 },
  ].map((e) => ({ ...e, lastModified: new Date() }));

  try {
    const [products, categories] = await Promise.all([
      db.product.findMany({ where: { status: "ACTIVE" }, select: { slug: true, updatedAt: true } }),
      db.category.findMany({ where: { isActive: true }, select: { slug: true } }),
    ]);
    return [
      ...statics,
      ...categories.map((c) => ({
        url: `${SITE}/categories/${c.slug}`,
        lastModified: new Date(),
        changeFrequency: "weekly" as const,
        priority: 0.75,
      })),
      ...products.map((p) => ({
        url: `${SITE}/products/${p.slug}`,
        lastModified: p.updatedAt,
        changeFrequency: "weekly" as const,
        priority: 0.8,
      })),
    ];
  } catch {
    return statics;
  }
}
