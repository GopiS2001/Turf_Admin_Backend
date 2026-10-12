/** Browser origins allowed to call the API with credentials (website, admin dashboard, Expo web). */
export const allowedOrigins = () =>
  (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
