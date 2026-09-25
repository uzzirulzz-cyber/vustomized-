import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { money } from "@/lib/format";

export type StoreProduct = {
  id: string;
  name: string;
  slug: string;
  description: string;
  emoji: string;
  price: number;
  salePrice: number | null;
  badge: string | null;
  rating: number;
  salesCount: number;
  type: string;
  category?: { name: string; slug: string } | null;
};

export function ProductCard({ product }: { product: StoreProduct }) {
  const price = product.salePrice ?? product.price;
  const hasSale = product.salePrice != null && product.salePrice < product.price;
  return (
    <Link
      href={`/products/${product.slug}`}
      className="card-hover group flex flex-col rounded-xl border bg-card overflow-hidden"
    >
      <div className="relative h-36 bg-gradient-to-br from-secondary to-card flex items-center justify-center text-5xl">
        <span className="drop-shadow-[0_0_18px_rgba(56,189,248,0.45)] group-hover:scale-110 transition-transform duration-300">
          {product.emoji}
        </span>
        {product.badge && (
          <Badge className="absolute top-2 left-2 pb-orange-gradient border-0 text-[10px] font-bold text-white">
            {product.badge}
          </Badge>
        )}
        {hasSale && (
          <Badge className="absolute top-2 right-2 bg-red-500/90 border-0 text-[10px] font-bold text-white">
            SAVE {Math.round((1 - product.salePrice! / product.price) * 100)}%
          </Badge>
        )}
      </div>
      <div className="p-4 flex flex-col gap-1.5 flex-1">
        {product.category && (
          <span className="text-[11px] uppercase tracking-wide text-sky-400/80 font-medium">{product.category.name}</span>
        )}
        <h3 className="font-semibold text-sm leading-snug line-clamp-2 group-hover:text-sky-300 transition-colors">
          {product.name}
        </h3>
        <p className="text-xs text-muted-foreground line-clamp-2 flex-1">{product.description}</p>
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-baseline gap-1.5">
            <span className="text-sky-400 font-bold">{money(price)}</span>
            {hasSale && <span className="text-xs text-muted-foreground line-through">{money(product.price)}</span>}
          </div>
          <span className="text-[11px] text-muted-foreground">★ {product.rating.toFixed(1)}</span>
        </div>
      </div>
    </Link>
  );
}
