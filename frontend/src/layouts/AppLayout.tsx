import { Link, NavLink, Outlet, ScrollRestoration } from "react-router";
import { useAppSelector } from "@/store";

const navigation = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/logout", label: "Logout" },
];

export default function AppLayout() {
  const session = useAppSelector((state) => state.auth.session);
  const currentUserName = session?.user?.name;

  return (
    <div className="min-h-svh">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-10 focus:bg-background focus:p-4"
      >
        Skip to content
      </a>
      <header className="border-b">
        <div className="mx-auto flex max-w-8xl flex-wrap items-center gap-6 px-6 py-4">
          <Link to="/dashboard" className="font-heading text-lg font-semibold">
            Trading Blotter
          </Link>
          <nav aria-label="Main navigation" className="flex flex-wrap gap-2">
            {navigation.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
          {currentUserName && (
            <p className="ml-auto text-sm text-muted-foreground">
              Signed in as <span className="font-medium text-foreground">{currentUserName}</span>
            </p>
          )}
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-8xl space-y-6 p-6">
        <Outlet />
      </main>
      <ScrollRestoration />
    </div>
  );
}
