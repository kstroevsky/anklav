export type Credentials = {
  origin: string;
  clientId: string;
  clientName: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

export type CredentialStore = Record<string, Credentials>;
