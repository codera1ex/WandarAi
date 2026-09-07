"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";

export function Navbar() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.push("/");
    router.refresh();
  }

  return (
    <header className={`site-nav ${open ? "mobile-menu-open" : ""}`}>
      <div className="container">
        <div className="nav-inner">
          <Link className="brand" href="/" onClick={() => setOpen(false)}>
            <span className="brand-mark"><Icon name="compass" size={18} /></span>
            <span>Wander<span className="brand-accent">AI</span></span>
          </Link>
          <nav className="nav-links" aria-label="Primary navigation">
            <Link className="nav-link" href="/dashboard">
              <Icon name="compass" size={16} /> My trips
            </Link>
            <Link className="nav-link" href="/trips/new">
              <Icon name="plus" size={16} /> Plan a trip
            </Link>
          </nav>
          <div className="nav-actions">
            <Link className="nav-login" href="/login">Sign in</Link>
            <Link className="button button-primary button-small" href="/signup">Get started</Link>
          </div>
          <button
            className="mobile-menu-button"
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
          >
            <Icon name={open ? "x" : "menu"} size={22} />
          </button>
        </div>
        <nav className="mobile-menu" aria-label="Mobile navigation">
          <Link className="nav-link" href="/dashboard" onClick={() => setOpen(false)}>
            <Icon name="compass" size={18} /> My trips
          </Link>
          <Link className="nav-link" href="/trips/new" onClick={() => setOpen(false)}>
            <Icon name="plus" size={18} /> Plan a trip
          </Link>
          <Link className="nav-link" href="/login" onClick={() => setOpen(false)}>Sign in</Link>
          <Link className="nav-link" href="/signup" onClick={() => setOpen(false)}>Get started</Link>
          <button className="nav-link" type="button" disabled={loggingOut} onClick={handleLogout}>
            {loggingOut ? "Signing out…" : "Sign out"}
          </button>
        </nav>
      </div>
    </header>
  );
}