import { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { IconMenu2, IconX, IconBrandGithub, IconArrowUpRight } from "@tabler/icons-react";

const GITHUB_URL = "https://github.com/jsteele111/covenza-backend";
const TESTNET_DISMISS_KEY = "covenza.testnetBar.dismissed";

/**
 * The site's navigation.
 *
 * Replaces the old header (logo, a lone Dashboard link, the wallet button) and
 * the role-switcher row beneath it. Lend and Borrow are always listed: anyone
 * may open either, and each page explains its own requirements. Operator is
 * listed only for the wallet that holds the role — the route itself stays
 * open to anyone who types it, because everything it reads is public.
 */
function navItems(roles, connected) {
  const items = [
    { to: "/dashboard", label: "Dashboard" },
    { to: "/lender", label: "Lend" },
    { to: "/borrower", label: "Borrow" },
  ];
  // History is per wallet, so it is offered once a wallet is connected.
  if (connected) items.push({ to: "/history", label: "History" });
  if (roles.includes("operator")) items.push({ to: "/operator", label: "Operator" });
  return items;
}

/**
 * Slim, dismissible notice that everything here is test money.
 *
 * Remembered per browser so it does not nag on every page; if storage is
 * unavailable (private windows) it simply shows again, which is the safe
 * failure.
 */
export function TestnetBar() {
  const [hidden, setHidden] = useState(() => {
    try {
      return window.localStorage.getItem(TESTNET_DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  if (hidden) return null;

  function dismiss() {
    setHidden(true);
    try {
      window.localStorage.setItem(TESTNET_DISMISS_KEY, "1");
    } catch {
      /* not persisted; hidden for this visit only */
    }
  }

  return (
    <div className="testnet-bar" role="note">
      <div className="page">
        <p>
          <strong>Testnet.</strong> Runs on Robinhood Chain testnet with test tokens of no value.
          The protocol has not been independently audited.
        </p>
        <button type="button" className="icon-btn" onClick={dismiss} aria-label="Dismiss testnet notice">
          <IconX size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function SiteHeader({ roles, connected }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const items = navItems(roles, connected);
  const toggleRef = useRef(null);
  // Stable, so the drawer's open-effect does not re-run on every render.
  const close = useCallback(() => setOpen(false), []);

  // Any navigation closes the menu.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  return (
    <>
      <header className="site-header">
        <div className="page">
          <Link to="/" className="brand" aria-label="Covenza home">
            <span className="brand-mark" aria-hidden="true">&#9670;</span>
            <span className="brand-name">Covenza</span>
          </Link>

          <nav className="desktop-nav" aria-label="Main">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="header-actions">
            <ConnectButton
              showBalance={false}
              chainStatus={{ smallScreen: "none", largeScreen: "icon" }}
              accountStatus={{ smallScreen: "avatar", largeScreen: "full" }}
            />
            <button
              ref={toggleRef}
              type="button"
              className="icon-btn hamburger"
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              aria-controls="site-drawer"
              onClick={() => setOpen((v) => !v)}
            >
              <IconMenu2 size={22} aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <Drawer open={open} onClose={close} items={items} returnFocusTo={toggleRef} />
    </>
  );
}

/**
 * The phone menu. A modal panel from the right: focus moves into it on open,
 * Tab cycles within it, Escape or a tap outside closes it, focus returns to
 * the menu button, and the page behind does not scroll while it is open.
 */
function Drawer({ open, onClose, items, returnFocusTo }) {
  const panelRef = useRef(null);
  const closeRef = useRef(null);

  useEffect(() => {
    if (!open) return;

    document.body.classList.add("no-scroll");
    closeRef.current?.focus();
    const toggle = returnFocusTo.current;

    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("no-scroll");
      toggle?.focus();
    };
  }, [open, onClose, returnFocusTo]);

  return (
    <>
      <div className={`drawer-backdrop${open ? " open" : ""}`} onClick={onClose} aria-hidden="true" />
      <div
        id="site-drawer"
        ref={panelRef}
        className={`drawer${open ? " open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
      >
        <div className="drawer-head">
          <span className="brand">
            <span className="brand-mark" aria-hidden="true">&#9670;</span>
            <span className="brand-name">Covenza</span>
          </span>
          <button ref={closeRef} type="button" className="icon-btn" onClick={onClose} aria-label="Close menu">
            <IconX size={22} aria-hidden="true" />
          </button>
        </div>

        <nav className="drawer-nav" aria-label="Main">
          <div className="drawer-section-label">Navigate</div>
          <NavLink to="/" end className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
            Home
          </NavLink>
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="drawer-foot">
          <p className="note" style={{ margin: 0 }}>
            Robinhood Chain testnet. Test tokens only — nothing here involves real money, and the
            protocol has not been independently audited.
          </p>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn"
          >
            <IconBrandGithub size={16} aria-hidden="true" /> Source on GitHub
            <IconArrowUpRight size={14} aria-hidden="true" />
          </a>
        </div>
      </div>
    </>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="page">
        <div>
          <Link to="/" className="brand" style={{ marginBottom: 8 }}>
            <span className="brand-mark" aria-hidden="true">&#9670;</span>
            <span className="brand-name" style={{ fontSize: 17 }}>Covenza</span>
          </Link>
          <p style={{ margin: "8px 0 0", maxWidth: "46ch", lineHeight: 1.6 }}>
            Fixed-term, low-collateral, non-liquidating lending. Built on Robinhood Chain.
            Testnet only; not yet independently audited.
          </p>
        </div>
        <nav className="footer-links" aria-label="Footer">
          <Link to="/dashboard">Dashboard</Link>
          <Link to="/lender">Lend</Link>
          <Link to="/borrower">Borrow</Link>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
        </nav>
      </div>
    </footer>
  );
}
