"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/Icon";

type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  exact?: boolean;
};

const items: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: "home", exact: true },
  { href: "/dashboard", label: "My trips", icon: "compass", exact: true },
  { href: "/trips/new", label: "Plan trip", icon: "plus", exact: true },
  { href: "/profile", label: "Profile", icon: "user", exact: true }
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="bottom-nav" aria-label="App navigation">
      <div className="bottom-nav-inner">
        {items.map((item) => {
          const active = item.label === "Home"
            ? pathname === "/dashboard"
            : item.label === "My trips"
              ? pathname.startsWith("/trips/")
              : item.exact
                ? pathname === item.href
                : pathname.startsWith(item.href);
          return (
            <Link className={`bottom-nav-item ${active ? "is-active" : ""}`} href={item.href} key={item.label}>
              <span className="bottom-nav-icon"><Icon name={item.icon} size={20} /></span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}