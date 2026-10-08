import { useState, type FormEvent } from "react";
import { Navigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAppDispatch, useAppSelector } from "@/store";
import { tradesApi } from "@/store/api";
import { sessionReceived } from "@/store/auth";
import type { RequestError } from "@/lib/http-client";

export default function LoginPage() {
  const auth = useAppSelector((state) => state.auth);
  const dispatch = useAppDispatch();
  const [login, loginState] = tradesApi.useLoginMutation();
  const [message, setMessage] = useState("");

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setMessage("");
    try {
      const session = await login({
        username: String(fields.get("username")).trim(),
        password: String(fields.get("password")),
      }).unwrap();
      dispatch(sessionReceived({ session }));
      form.reset();
    } catch (error) {
      setMessage((error as RequestError).message || "Could not log in. Please try again.");
    } finally {
      loginState.reset();
    }
  }

  if (auth.status === "authenticated") {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <section aria-labelledby="login-heading" className="mx-auto max-w-md space-y-6">
      <header className="space-y-2">
        <h1 id="login-heading" className="font-heading text-2xl font-semibold">
          Login
        </h1>
        <p className="text-sm text-muted-foreground">Enter your credentials to log in.</p>
      </header>

      {!auth.initialized || auth.status === "checking" ? (
        <p role="status" className="text-sm text-muted-foreground">
          Checking your session…
        </p>
      ) : auth.status === "unavailable" && auth.session ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Could not verify your session.</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => dispatch(sessionReceived({ session: auth.session!, restored: true }))}
          >
            Try again
          </Button>
        </div>
      ) : (
        <form onSubmit={(event) => void signIn(event)} className="space-y-4" aria-label="Log in">
          <div className="space-y-1.5">
            <Label htmlFor="login-username">Username</Label>
            <Input
              id="login-username"
              name="username"
              autoComplete="username"
              required
              maxLength={255}
              disabled={loginState.isLoading}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="login-password">Password</Label>
            <Input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={1024}
              disabled={loginState.isLoading}
            />
          </div>
          <Button type="submit" disabled={loginState.isLoading}>
            {loginState.isLoading ? "Logging in…" : "Log in"}
          </Button>
        </form>
      )}

      {(message || auth.message) && (
        <p role="alert" className="text-sm text-destructive">
          {message || auth.message}
        </p>
      )}
      {auth.persistenceError && (
        <p role="alert" className="text-sm text-destructive">
          {auth.persistenceError}
        </p>
      )}
    </section>
  );
}
