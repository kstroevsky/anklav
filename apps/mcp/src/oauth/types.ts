export type ClientRegistration = {
  client_id: string;
  client_name: string;
};

export type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};
