"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShoppingCart, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

export function BuyButton({ productId, signedIn, label = "Buy Now" }: { productId: string; signedIn: boolean; label?: string }) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const router = useRouter();

  const buy = async () => {
    if (!signedIn) {
      router.push(`/signin?next=/products`);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, quantity: 1, paymentMethod: "CARD" }),
      });
      const data = await res.json();
      if (res.ok) {
        setDone(true);
        toast({ title: "Order placed 🎉", description: `${data.orderNo} confirmed — check your account for details.` });
        setTimeout(() => setDone(false), 4000);
      } else {
        toast({ title: "Checkout failed", description: data.error, variant: "destructive" });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      onClick={buy}
      disabled={loading || done}
      className="pb-orange-gradient border-0 text-white font-semibold hover:opacity-90 glow-orange h-11 px-6"
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : done ? <CheckCircle2 className="h-4 w-4" /> : <ShoppingCart className="h-4 w-4" />}
      {done ? "Ordered!" : label}
    </Button>
  );
}
