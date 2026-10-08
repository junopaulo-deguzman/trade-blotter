import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { useAppSelector, useAppDispatch } from "@/store";
import { tradesApi } from "@/store/api";
import { sessionCleared } from "@/store/auth";
import type { RequestError } from "@/lib/http-client";

export default function LogoutPage() {
  const auth = useAppSelector((state) => state.auth);
  const dispatch = useAppDispatch();
  const [logout, logoutState] = tradesApi.useLogoutMutation();
  const started = useRef(false);
  const [status, setStatus] = useState<"pending" | "complete">("pending");
  const [timer, setTimer] = useState(3);
  const [message, setMessage] = useState("");
  const [unrevokedToken, setUnrevokedToken] = useState<string | null>(null);

  const redirectWithTimer = useCallback(async function redirectWithTimer() {
    const countdown = setInterval(() => {
      setTimer((prev) => prev - 1);
    }, 1000);
    setTimeout(() => {
      clearInterval(countdown);
      window.location.href = "/login"; // or "/" for home page
    }, 3000); // 3-second countdown before redirect
    setTimer(3); // reset the timer for the next potential logout
  }, []);

  const revokeSession = useCallback(
    async function revokeSession(token: string, request = logout(token)) {
      setStatus("pending");
      setMessage("");
      try {
        await request.unwrap();
        setUnrevokedToken(null);
        setStatus("complete");
        // redirect to the login page or home page after successful logout with countdown
        void redirectWithTimer();
      } catch (error) {
        if ((error as RequestError).code === "UNAUTHORIZED") {
          setUnrevokedToken(null);
          setStatus("complete");
        } else {
          setUnrevokedToken(token);
          setMessage("You are logged out locally, but the server session could not be revoked.");
          setStatus("complete");
        }
      } finally {
        logoutState.reset();
      }
    },
    [logout, logoutState, redirectWithTimer],
  );

  useEffect(() => {
    if (started.current) return;
    if (!auth.initialized) return;
    started.current = true;

    const token = auth.session?.accessToken;
    if (!token) {
      setStatus("complete");
      window.location.href = "/login";
      return;
    }

    const request = logout(token);
    dispatch(sessionCleared({ token }));
    void revokeSession(token, request);
  }, [auth.initialized, auth.session?.accessToken, dispatch, logout, revokeSession]);

  return (
    <section aria-labelledby="logout-heading" className="mx-auto max-w-md space-y-6">
      <header className="space-y-2">
        <h1 id="logout-heading" className="font-heading text-2xl font-semibold">
          {status === "pending" ? "Logging out" : `You will be redirected shortly in ${timer}...`}
        </h1>
        <p className="text-sm text-muted-foreground">
          {status === "pending" ? "Ending your session…" : message || "You have been logged out."}
        </p>
      </header>
      {unrevokedToken && (
        <Button
          variant="outline"
          size="sm"
          disabled={logoutState.isLoading}
          onClick={() => void revokeSession(unrevokedToken)}
        >
          Retry server logout
        </Button>
      )}
      {auth.persistenceError && (
        <p role="alert" className="text-sm text-destructive">
          {auth.persistenceError}
        </p>
      )}
    </section>
  );
}
