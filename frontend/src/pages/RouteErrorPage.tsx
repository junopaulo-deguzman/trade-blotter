import { Link } from "react-router";

export default function RouteErrorPage() {
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-6">
      <h1 className="font-heading text-2xl font-semibold">Something went wrong</h1>
      <p className="text-muted-foreground">Please refresh the page or return to the dashboard.</p>
      <Link to="/dashboard" className="underline underline-offset-4">
        Go to dashboard
      </Link>
    </main>
  );
}
