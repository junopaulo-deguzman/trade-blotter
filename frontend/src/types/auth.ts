export interface User {
  id: number;
  username: string;
  name: string;
}

export interface LoginInput {
  username: string;
  password: string;
}

export interface Session {
  accessToken: string;
  tokenType: "Bearer";
  expiresAt: string;
  user: User;
}

export interface AuthClient {
  login(input: LoginInput): Promise<Session>;
  me(token: string, signal?: AbortSignal): Promise<User>;
  logout(token: string): Promise<void>;
}
