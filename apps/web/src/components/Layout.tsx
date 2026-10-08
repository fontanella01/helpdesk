import { Link, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Button } from "./ui";

export function Layout() {
  const { user, logout } = useAuth();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <Link to="/tickets" className="text-base font-bold tracking-tight">
              Help<span className="text-brand-600">Desk</span>
            </Link>
            <nav className="flex gap-1 text-sm font-medium">
              {[["/tickets", "Tickets"], ["/dashboard", "Dashboard"]].map(([to, label]) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) => `rounded-md px-3 py-1.5 ${isActive ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:text-ink"}`}
                >
                  {label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-slate-600 sm:inline">
              {user?.name} · <span className="capitalize">{user?.role}</span>
            </span>
            <Button variant="ghost" onClick={logout}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
