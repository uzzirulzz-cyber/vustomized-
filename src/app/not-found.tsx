import Link from "next/link";
import { PlayCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 hero-grid-bg">
      <span className="pb-gradient rounded-xl p-3 glow-blue mb-6"><PlayCircle className="h-8 w-8 text-[#04121f]" /></span>
      <h1 className="text-6xl font-extrabold pb-gradient-text">404</h1>
      <p className="text-muted-foreground mt-3 mb-8">That beat dropped out of the mix. The page you&apos;re looking for doesn&apos;t exist.</p>
      <div className="flex gap-3">
        <Link href="/" className="pb-gradient text-[#04121f] font-semibold rounded-lg px-5 py-2.5 hover:opacity-90 transition-opacity">Back to Home</Link>
        <Link href="/products" className="border border-border rounded-lg px-5 py-2.5 hover:bg-accent transition-colors">Browse Products</Link>
      </div>
    </div>
  );
}
