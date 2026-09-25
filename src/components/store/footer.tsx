import Link from "next/link";
import { PlayCircle, Mail, ShieldCheck, Zap } from "lucide-react";

const COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Shop",
    links: [
      { href: "/products", label: "All Products" },
      { href: "/subscriptions", label: "Subscriptions" },
      { href: "/categories", label: "Categories" },
      { href: "/offers", label: "Offers" },
      { href: "/projector-comparison", label: "Projector Comparison" },
    ],
  },
  {
    title: "Support",
    links: [
      { href: "/support", label: "Help Center" },
      { href: "/support/warranty-replacement", label: "Warranty & Replacement Policy" },
      { href: "/support/refund-policy", label: "Refund Policy" },
      { href: "/contact", label: "Contact" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/support/privacy-policy", label: "Privacy Policy" },
      { href: "/support/terms-of-service", label: "Terms of Service" },
      { href: "/admin/signin", label: "Staff Portal" },
    ],
  },
];

export function StoreFooter() {
  return (
    <footer className="mt-auto border-t bg-sidebar">
      <div className="mx-auto max-w-7xl px-4 py-12">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
          <div className="col-span-2">
            <Link href="/" className="flex items-center gap-2 mb-3">
              <span className="pb-gradient rounded-lg p-1.5 glow-blue">
                <PlayCircle className="h-5 w-5 text-[#04121f]" />
              </span>
              <span className="text-lg font-extrabold tracking-tight">Play<span className="pb-gradient-text">Beat</span></span>
            </Link>
            <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
              Your one-stop digital marketplace for streaming subscriptions, AI tools, gift cards,
              game keys, genuine software and smart 4K projectors — delivered instantly.
            </p>
            <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><Zap className="h-3.5 w-3.5 text-sky-400" />Instant delivery</span>
              <span className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />Secure payments</span>
            </div>
            <a href="mailto:support@playbeat.digital" className="flex items-center gap-1.5 text-xs text-sky-400 mt-3 hover:underline">
              <Mail className="h-3.5 w-3.5" />support@playbeat.digital
            </a>
          </div>
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h4 className="text-sm font-semibold mb-3">{col.title}</h4>
              <ul className="space-y-2">
                {col.links.map((l) => (
                  <li key={l.href + l.label}>
                    <Link href={l.href} className="text-sm text-muted-foreground hover:text-sky-400 transition-colors">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t mt-10 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} PlayBeat Digital. All rights reserved.</span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live support available — chat with us any time
          </span>
        </div>
      </div>
    </footer>
  );
}
