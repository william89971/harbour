"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

export function BackLink({ href, label }: { href: string; label: string }) {
  const router = useRouter();
  return (
    <button
      className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
      onClick={() => router.push(href)}
    >
      <ArrowLeft className="h-4 w-4" /> {label}
    </button>
  );
}
