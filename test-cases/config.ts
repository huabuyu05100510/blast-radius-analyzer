// Test case: Constants and types
export const API_BASE_URL = 'https://api.example.com';

export const MAX_RETRIES = 3;

export type UserStatus = 'active' | 'inactive' | 'pending';

export const DEFAULT_USER: UserStatus = 'pending';

export const CONFIG = {
  timeout: 5000,
  retries: 3,
};
