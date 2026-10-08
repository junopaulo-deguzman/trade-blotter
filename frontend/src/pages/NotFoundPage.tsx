import { Link } from "react-router";

export default function NotFoundPage() {
  return (
    <section className="space-y-4">
      <h1 className="font-heading text-2xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground">The page you requested does not exist.</p>
      <Link to="/dashboard" className="underline underline-offset-4">
        Go to dashboard
      </Link>
    </section>
  );
}
