import { createBrowserRouter, Navigate } from "react-router";
import LoginPage from "./pages/LoginPage";
import LogoutPage from "./pages/LogoutPage";
import AppLayout from "./layouts/AppLayout";
import PublicLayout from "./layouts/PublicLayout";

import DashboardPage from "./pages/DashboardPage";
import NotFoundPage from "./pages/NotFoundPage";
import RouteErrorPage from "./pages/RouteErrorPage";
import { ProtectedRoute } from "./components/ProtectedRoutes";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: PublicLayout,
    children: [
      { index: true, element: <Navigate to="/login" replace /> },
      { path: "login", Component: LoginPage },
      { path: "logout", Component: LogoutPage },
      { path: "*", Component: NotFoundPage },
    ],
  },
  {
    path: "/dashboard",
    ErrorBoundary: RouteErrorPage,
    element: <ProtectedRoute redirectPath="/login" />,
    children: [
      {
        path: "/dashboard",
        Component: AppLayout,
        ErrorBoundary: RouteErrorPage,
        children: [{ index: true, Component: DashboardPage }],
      },
    ],
  },
]);
