// Complex test: nested property access
export const config = {
  api: {
    baseUrl: 'https://api.example.com',
    timeout: 5000,
  },
  db: {
    host: 'localhost',
    port: 5432,
  },
};

// Class with methods
export class UserService {
  private apiUrl = config.api.baseUrl;

  getUser(id: string) {
    return fetch(`${this.apiUrl}/users/${id}`);
  }
}

// Function using dynamic property
export const getConfig = (key: string) => {
  return (config as any)[key];
};
