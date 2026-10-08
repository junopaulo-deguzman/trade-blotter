import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Session, User } from "@/types/auth";

interface AuthState {
  initialized: boolean;
  session: Session | null;
  status: "anonymous" | "checking" | "authenticated" | "unavailable";
  message: string;
  persistenceError: string;
}

const initialState: AuthState = {
  initialized: false,
  session: null,
  status: "anonymous",
  message: "",
  persistenceError: "",
};
export const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    sessionReceived(state, action: PayloadAction<{ session: Session; restored?: boolean }>) {
      state.initialized = true;
      state.session = action.payload.session;
      state.status = action.payload.restored ? "checking" : "authenticated";
      state.message = "";
    },
    sessionVerified(state, action: PayloadAction<{ token: string; user: User }>) {
      if (state.session?.accessToken !== action.payload.token) return;
      state.initialized = true;
      state.session.user = action.payload.user;
      state.status = "authenticated";
      state.message = "";
    },
    verificationFailed(state, action: PayloadAction<{ token: string; message: string }>) {
      if (state.session?.accessToken !== action.payload.token) return;
      state.initialized = true;
      state.status = "unavailable";
      state.message = action.payload.message;
    },
    sessionCleared(state, action: PayloadAction<{ token?: string; message?: string } | undefined>) {
      if (action.payload?.token && state.session?.accessToken !== action.payload.token) return;
      state.initialized = true;
      state.session = null;
      state.status = "anonymous";
      state.message = action.payload?.message ?? "";
    },
    persistenceFailed(state, action: PayloadAction<string>) {
      state.initialized = true;
      state.persistenceError = action.payload;
    },
  },
});

export const {
  sessionReceived,
  sessionVerified,
  verificationFailed,
  sessionCleared,
  persistenceFailed,
} = authSlice.actions;
