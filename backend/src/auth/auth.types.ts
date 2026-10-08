import { z } from "zod";
import { requiredText } from "../shared/validation.ts";
export const loginSchema = z.strictObject({
  username: requiredText,
  password: z.string().min(1).max(1024),
});
export const provisionUserSchema = z.strictObject({
  username: requiredText,
  name: requiredText,
  password: z.string().min(12).max(1024),
});
export type ProvisionUserInput = z.infer<typeof provisionUserSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export interface UserRow {
  id: number;
  user_name: string;
  name: string;
  password_hash: string;
}
export interface UserResponse {
  id: number;
  username: string;
  name: string;
}
export interface SessionRow {
  user_id: number;
  user_name: string;
  name: string;
  expires_at: Date;
}
export interface AuthContext {
  user: UserResponse;
  tokenHash: string;
}
export interface LoginResponse {
  accessToken: string;
  tokenType: "Bearer";
  expiresAt: string;
  user: UserResponse;
}
