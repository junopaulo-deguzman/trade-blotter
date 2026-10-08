export type ErrorCode =
  | "VALIDATION_ERROR"
  | "INVALID_CREDENTIALS"
  | "UNAUTHORIZED"
  | "TRADE_FORBIDDEN"
  | "TRADE_NOT_ACTIVE"
  | "TRADE_NOT_FOUND"
  | "USER_NOT_FOUND"
  | "ROUTE_NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export interface ApiErrorResponse {
  error: string;
  code: ErrorCode;
  fieldErrors?: Record<string, string[]>;
}
