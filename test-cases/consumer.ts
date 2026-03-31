import { API_BASE_URL, MAX_RETRIES, UserStatus, CONFIG } from './config';

export const fetchUser = async (id: string): Promise<any> => {
  const url = `${API_BASE_URL}/users/${id}`;
  // Use MAX_RETRIES
  for (let i = 0; i < MAX_RETRIES; i++) {
    // retry logic
  }
  return { url, status: 'active' as UserStatus };
};

export const getConfig = () => CONFIG.timeout;
