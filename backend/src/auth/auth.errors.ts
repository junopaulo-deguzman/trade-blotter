export type AuthFailure =
  | { reason: "invalid_credentials" }
  | { reason: "invalid_session" }
  | { reason: "user_not_found"; username: string }
  | { reason: "username_already_exists"; username: string };

export class AuthError extends Error {
  readonly failure: AuthFailure;

  constructor(failure: AuthFailure) {
    let message: string;
    switch (failure.reason) {
      case "invalid_credentials":
        message = "Invalid username or password.";
        break;
      case "invalid_session":
        message = "Invalid session.";
        break;
      case "user_not_found":
        message = "User not found.";
        break;
      case "username_already_exists":
        message = "Username already exists.";
        break;
    }
    super(message);
    this.name = "AuthError";
    this.failure = failure;
  }
}
