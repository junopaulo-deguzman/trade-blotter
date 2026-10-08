// components/ProtectedRoute.tsx
import { Navigate, Outlet } from "react-router";

import { useAppSelector } from "@/store";

interface ProtectedRouteProps {
  redirectPath?: string;
}

export const ProtectedRoute = ({ redirectPath = "/login" }: ProtectedRouteProps) => {
  const auth = useAppSelector((state) => state.auth);

  if (!auth.initialized || auth.status === "checking") {
    return <p role="status">Checking your session…</p>;
  }

  if (auth.status !== "authenticated") {
    return <Navigate to={redirectPath} replace />;
  }

  return <Outlet />;
};
