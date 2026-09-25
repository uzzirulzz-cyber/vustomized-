"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { PlayCircle, Search, User, LogOut, Package, MessageSquare, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Me = { kind: string; customer?: { id: string; name: string; email: string }; staff?: { name: string } } | null;

const NAV = [
  { href: "/", label: "Home" },
  { href: "/products", label: "Products" },
  { href: "/subscriptions", label: "Subscriptions" },
  { href: "/categories", label: "Categories" },
  { href: "/offers", label: "Offers" },
  { href: "/projector-comparison", label: "Projectors" },
  { href: "/support", label: "Support" },
];

export function StoreHeader() {
  const [me, setMe] = useState<Me>(null);
  const [q, setQ] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then(setMe)
      .catch(() => {});
  }, [pathname]);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "customer" }) });
    setMe(null);
    router.push("/");
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-40 glass-strong border-b">
      <div className="mx-auto max-w-7xl px-4 h-16 flex items-center gap-4">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="pb-gradient rounded-lg p-1.5 glow-blue">
            <PlayCircle className="h-5 w-5 text-[#04121f]" />
          </span>
          <span className="text-lg font-extrabold tracking-tight">
            Play<span className="pb-gradient-text">Beat</span>
          </span>
        </Link>

        <nav className="hidden lg:flex items-center gap-1">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                pathname === n.href ? "text-sky-400 bg-sky-500/10" : "text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <form onSubmit={submitSearch} className="hidden md:flex flex-1 max-w-xs ml-auto relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search products..."
            className="pl-9 h-9 bg-input/40 border-border text-sm"
            aria-label="Search products"
          />
        </form>

        <div className="flex items-center gap-2 ml-auto md:ml-0">
          {me?.customer ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-1.5 h-9">
                  <span className="pb-gradient rounded-full p-0.5"><User className="h-4 w-4 text-[#04121f]" /></span>
                  <span className="hidden sm:inline text-sm max-w-24 truncate">{me.customer.name.split(" ")[0]}</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>{me.customer.email}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild><Link href="/account"><Package className="h-4 w-4 mr-2" />My Orders</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link href="/account?tab=messages"><MessageSquare className="h-4 w-4 mr-2" />Messages</Link></DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout}><LogOut className="h-4 w-4 mr-2" />Sign Out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              <Button asChild variant="ghost" className="h-9 text-sm">
                <Link href="/signup">Sign Up</Link>
              </Button>
              <Button asChild className="h-9 text-sm pb-gradient border-0 text-[#04121f] font-semibold hover:opacity-90">
                <Link href="/signin">Sign In</Link>
              </Button>
            </>
          )}
          <Button variant="ghost" size="icon" className="lg:hidden h-9 w-9" onClick={() => setMobileOpen((v) => !v)} aria-label="Menu">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
          </Button>
        </div>
      </div>

      {mobileOpen && (
        <div className="lg:hidden border-t px-4 py-3 glass-strong">
          <form onSubmit={submitSearch} className="relative mb-3 md:hidden">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products..." className="pl-9 h-9 bg-input/40" />
          </form>
          <div className="grid grid-cols-2 gap-1">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} onClick={() => setMobileOpen(false)}
                className={`px-3 py-2 rounded-lg text-sm font-medium ${pathname === n.href ? "text-sky-400 bg-sky-500/10" : "text-muted-foreground"}`}>
                {n.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
