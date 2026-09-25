"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard, ShoppingCart, Package, Users, CreditCard, BarChart3,
  MessageSquare, UserCog, ShieldCheck, Bell, ScrollText, Settings, LogOut,
  PlayCircle, Menu, X, ChevronRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/permissions";
import type { StaffSession } from "@/lib/auth";

const NAV = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, perm: "dashboard.read" },
  { href: "/admin/orders", label: "Orders", icon: ShoppingCart, perm: "orders.read" },
  { href: "/admin/products", label: "Products", icon: Package, perm: "products.read" },
  { href: "/admin/customers", label: "Customers", icon: Users, perm: "customers.read" },
  { href: "/admin/payments", label: "Payments & Refunds", icon: CreditCard, perm: "payments.read" },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3, perm: "analytics.read" },
  { href: "/admin/messages", label: "Messages", icon: MessageSquare, perm: "messages.read" },
  { href: "/admin/staff", label: "Staff", icon: UserCog, perm: "staff.read" },
  { href: "/admin/roles", label: "Roles & Permissions", icon: ShieldCheck, perm: "roles.read" },
  { href: "/admin/notifications", label: "Notifications", icon: Bell, perm: "dashboard.read" },
  { href: "/admin/audit", label: "Audit Log", icon: ScrollText, perm: "audit.read" },
  { href: "/admin/settings", label: "Settings", icon: Settings, perm: "settings.manage" },
];

type Me = {
  staff: {
    id: string; name: string; email: string; title: string | null;
    role: string; roleName: string; rank: number; permissions: string[];
  };
};

export function AdminShell({ staff, children }: { staff: StaffSession; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [unreadMsgs, setUnreadMsgs] = useState(0);
  const [unreadNotifs, setUnreadNotifs] = useState(0);

  // poll unread counters (messages + notifications)
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        if (can(staff.role.permissions, "messages.read")) {
          const [sup, dm] = await Promise.all([
            fetch("/api/conversations?box=support").then((r) => (r.ok ? r.json() : { conversations: [] })),
            fetch("/api/conversations?box=direct").then((r) => (r.ok ? r.json() : { conversations: [] })),
          ]);
          if (alive) {
            const supUnread = (sup.conversations ?? []).filter((c: { unread: number }) => c.unread > 0).length;
            const dmUnread = (dm.conversations ?? []).filter((c: { unread: number }) => c.unread > 0).length;
            setUnreadMsgs(supUnread + dmUnread);
          }
        }
        const n = await fetch("/api/notifications?unread=1").then((r) => (r.ok ? r.json() : { unread: 0 }));
        if (alive) setUnreadNotifs(n.unread ?? 0);
      } catch { /* offline */ }
    };
    tick();
    const t = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [staff.role.permissions]);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "staff" }) });
    router.push("/admin/signin");
    router.refresh();
  };

  const items = NAV.filter((n) => can(staff.role.permissions, n.perm));

  const renderNavLinks = (onNavigate?: () => void) => (
    <nav className="flex-1 space-y-1 px-3 py-4 overflow-y-auto nice-scroll">
      {items.map((n) => {
        const active = pathname === n.href;
        return (
          <Link
            key={n.href}
            href={n.href}
            onClick={onNavigate}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
              active ? "bg-sky-500/15 text-sky-300 border border-sky-500/30" : "text-muted-foreground hover:text-foreground hover:bg-accent border border-transparent"
            }`}
          >
            <n.icon className="h-[18px] w-[18px] shrink-0" />
            <span className="flex-1">{n.label}</span>
            {n.href === "/admin/messages" && unreadMsgs > 0 && (
              <span className="h-5 min-w-5 px-1.5 rounded-full bg-orange-500 text-white text-[10px] font-bold flex items-center justify-center">{unreadMsgs}</span>
            )}
            {n.href === "/admin/notifications" && unreadNotifs > 0 && (
              <span className="h-5 min-w-5 px-1.5 rounded-full bg-sky-500 text-[#04121f] text-[10px] font-bold flex items-center justify-center">{unreadNotifs}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  const renderBrand = () => (
    <>
      <div className="h-16 flex items-center gap-2.5 px-5 border-b shrink-0">
        <span className="pb-gradient rounded-lg p-1.5 glow-blue"><PlayCircle className="h-5 w-5 text-[#04121f]" /></span>
        <div>
          <div className="font-extrabold leading-none">Play<span className="pb-gradient-text">Beat</span></div>
          <div className="text-[10px] text-muted-foreground mt-0.5 tracking-wide uppercase">Admin Panel</div>
        </div>
      </div>
      <div className="px-5 py-4 border-b shrink-0">
        <div className="flex items-center gap-3">
          <span className="pb-gradient rounded-full h-9 w-9 flex items-center justify-center text-[#04121f] font-bold text-sm shrink-0">
            {staff.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{staff.name}</div>
            <Badge variant="outline" className="text-[9px] border-sky-500/40 text-sky-300">{staff.role.name}</Badge>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-64 border-r bg-sidebar fixed inset-y-0 z-30">
        {renderBrand()}
        {renderNavLinks()}
        <div className="p-3 border-t shrink-0">
          <Button variant="ghost" onClick={logout} className="w-full justify-start gap-3 text-muted-foreground hover:text-red-400">
            <LogOut className="h-[18px] w-[18px]" /> Sign out
          </Button>
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-sidebar border-r flex flex-col">
            <div className="flex items-center justify-between pr-3">
              {renderBrand()}
              <Button variant="ghost" size="icon" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></Button>
            </div>
            {renderNavLinks(() => setMobileOpen(false))}
            <div className="p-3 border-t">
              <Button variant="ghost" onClick={logout} className="w-full justify-start gap-3 text-muted-foreground"><LogOut className="h-[18px] w-[18px]" /> Sign out</Button>
            </div>
          </aside>
        </div>
      )}

      <div className="flex-1 lg:pl-64 flex flex-col min-h-screen">
        {/* Topbar */}
        <header className="h-16 glass-strong border-b flex items-center gap-3 px-4 md:px-6 sticky top-0 z-20">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </Button>
          <div className="hidden md:flex items-center gap-1.5 text-sm text-muted-foreground">
            Admin <ChevronRight className="h-3.5 w-3.5" />
            <span className="text-foreground font-medium">{items.find((n) => n.href === pathname)?.label ?? "Panel"}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/" target="_blank" className="text-xs text-muted-foreground hover:text-sky-400 hidden sm:flex items-center gap-1.5">
              <Image src="/favicon.svg" alt="" width={14} height={14} /> View storefront ↗
            </Link>
            <Link href="/admin/notifications" className="relative p-2 rounded-lg hover:bg-accent" aria-label="Notifications">
              <Bell className="h-[18px] w-[18px]" />
              {unreadNotifs > 0 && <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-orange-500" />}
            </Link>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
