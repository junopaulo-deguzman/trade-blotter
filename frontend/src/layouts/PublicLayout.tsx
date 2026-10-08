import { Outlet, ScrollRestoration } from "react-router";

export default function PublicLayout() {
  return (
    <div className="min-h-svh">
      <header className="bg-gray-100 p-4">
        <h1 className="text-xl font-bold">Trade Blotter</h1>
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-6xl space-y-6 p-6">
        <Outlet />
      </main>
      <ScrollRestoration />
    </div>
  );
}
