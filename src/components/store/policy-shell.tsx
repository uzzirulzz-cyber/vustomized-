import Link from "next/link";
import { ChevronRight } from "lucide-react";

/** Shared shell for static policy pages. */
export function PolicyShell({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <nav className="text-xs text-muted-foreground mb-4 flex items-center gap-1" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-sky-400">Home</Link> <ChevronRight className="h-3 w-3" />
        <Link href="/support" className="hover:text-sky-400">Support</Link> <ChevronRight className="h-3 w-3" />
        <span className="text-foreground">{title}</span>
      </nav>
      <h1 className="text-3xl font-extrabold mb-1">{title}</h1>
      <p className="text-xs text-muted-foreground mb-8">Last updated: {updated}</p>
      <div className="space-y-6 text-[15px] leading-relaxed text-foreground/90 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:mt-8 [&_h2]:mb-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1.5 [&_a]:text-sky-400">{children}</div>
    </div>
  );
}
