"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApp } from "./app-context";
import {
  Activity,
  Briefcase,
  Bot,
  CalendarCheck,
  FileText,
  Database,
  KeyRound,
  Users,
  Users2,
  Settings,
  MessageSquare,
  DollarSign,
  Workflow,
  LayoutDashboard,
  Target,
  CheckSquare,
  Scale,
  GitBranch,
  Inbox,
  Building2,
  Send,
  Mail,
} from "lucide-react";

export function NavLinks({ onClick }: { onClick?: () => void }) {
  const pathname = usePathname();
  const { waitingCount, pendingApprovalsCount, pendingOutreachCount } = useApp();

  const links = [
    { href: "/", label: "Today", icon: LayoutDashboard, badge: waitingCount },
    { href: "/weekly-reviews", label: "Weekly", icon: CalendarCheck },
    { href: "/captain", label: "Captain", icon: MessageSquare },
    { href: "/approvals", label: "Approvals", icon: Inbox, badge: pendingApprovalsCount },
    { href: "/runs", label: "Runs", icon: Activity },
    { href: "/workflows", label: "Workflows", icon: Workflow },
    { href: "/jobs", label: "Jobs", icon: Briefcase },
    { href: "/agents", label: "Agents", icon: Bot },
    { href: "/teams", label: "Teams", icon: Users2 },
    { href: "/docs", label: "Docs", icon: FileText },
    { href: "/goals", label: "Goals", icon: Target },
    { href: "/tasks", label: "Tasks", icon: CheckSquare },
    { href: "/decisions", label: "Decisions", icon: Scale },
    { href: "/databases", label: "Databases", icon: Database },
    { href: "/contacts", label: "Contacts", icon: Users },
    { href: "/companies", label: "Companies", icon: Building2 },
    { href: "/outreach", label: "Outreach", icon: Send, badge: pendingOutreachCount },
    { href: "/integrations/github", label: "GitHub", icon: GitBranch },
    { href: "/integrations/gmail", label: "Gmail", icon: Mail },
    { href: "/env-vars", label: "Env Vars", icon: KeyRound },
    { href: "/users", label: "Users", icon: Users },
    { href: "/usage", label: "Usage", icon: DollarSign },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <nav className="flex flex-col gap-0.5 px-2">
      {links.map((link) => {
        const isActive = link.href === "/"
          ? pathname === "/"
          : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            onClick={onClick}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <link.icon className="h-4 w-4" />
            {link.label}
            {"badge" in link && (link.badge ?? 0) > 0 && (
              <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-medium leading-none text-primary-foreground">
                {link.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
