"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  Package,
  Columns3,
  PlusCircle,
  FolderOpen,
  Settings,
  LogOut,
  RefreshCw,
  FileBox,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

const NAV_ITEMS = [
  { href: "/pedidos", label: "Pedidos", icon: Package },
  { href: "/gerar-molde", label: "Gerar Molde", icon: FileBox },
  { href: "/producao", label: "Producao", icon: Columns3 },
  { href: "/avulso", label: "Avulso", icon: PlusCircle },
  { href: "/arquivos", label: "Arquivos", icon: FolderOpen },
];

interface AppHeaderProps {
  userName?: string;
  userRole?: string;
}

export function AppHeader({ userName, userRole }: AppHeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const activeLine = pathname.startsWith("/producao")
    ? "uniquebox"
    : pathname.startsWith("/gerar-molde")
    ? "uniquekids"
    : null;

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  function handleRefresh() {
    setRefreshing(true);
    queryClient.invalidateQueries();
    setTimeout(() => setRefreshing(false), 600);
  }

  return (
    <header className="sticky top-0 z-40 bg-paper border-b border-line">
      {/* Accent bar */}
      <div
        className={cn(
          "h-[3px] transition-colors duration-300",
          activeLine === "uniquebox" && "bg-uniquebox",
          activeLine === "uniquekids" && "bg-uniquekids",
          !activeLine && "bg-line"
        )}
      />

      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-14">
          {/* Logo + Nav */}
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={() => router.push("/")}
              className="font-bold text-base tracking-tight mr-3 sm:mr-5 hover:opacity-70 transition-opacity"
            >
              UNIQUE
            </button>

            <nav className="flex items-center gap-1">
              {NAV_ITEMS.map((item) => {
                const isActive = pathname.startsWith(item.href);
                return (
                  <button
                    key={item.href}
                    onClick={() => router.push(item.href)}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150",
                      isActive
                        ? "bg-ink text-paper shadow-sm"
                        : "text-ink-muted hover:text-ink hover:bg-surface"
                    )}
                  >
                    <item.icon size={16} />
                    <span className="hidden sm:inline">{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2">
            {userRole === "admin" && (
              <button
                onClick={() => router.push("/admin/usuarios")}
                className="p-2 rounded-lg text-ink-faint hover:text-ink hover:bg-surface transition-colors"
              >
                <Settings size={18} />
              </button>
            )}

            <button
              onClick={handleRefresh}
              className="p-2 rounded-lg text-ink-faint hover:text-ink hover:bg-surface transition-colors"
            >
              <RefreshCw
                size={18}
                className={cn(refreshing && "animate-spin")}
              />
            </button>

            <div className="w-px h-6 bg-line mx-1.5" />

            <span className="text-sm text-ink-muted hidden sm:inline">
              {userName}
            </span>

            <button
              onClick={handleLogout}
              className="p-2 rounded-lg text-ink-faint hover:text-danger hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
